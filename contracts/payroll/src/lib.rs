//! Pactsmith Payroll Vault: a fixed team, a fixed pay per period, a fixed number of periods.
//! Funded once with the exact total, so every paycheck is guaranteed. No owner, no admin,
//! no setters, and the funder cannot withdraw. Written from scratch; not audited.
use near_sdk::json_types::U64;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Payee {
    pub account: AccountId,
    pub claimed: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PayrollVault {
    funder: AccountId,
    payees: Vec<Payee>,
    amount: NearToken,
    period_ns: u64,
    periods: u32,
    start_ns: u64,
    funded: bool,
}

#[near]
impl PayrollVault {
    #[init]
    pub fn new(
        funder: AccountId,
        payees: Vec<AccountId>,
        amount: NearToken,
        period_ns: U64,
        periods: u32,
        start_ns: U64,
    ) -> Self {
        require!(!payees.is_empty() && payees.len() <= 20, "Use 1 to 20 payees");
        for (i, p) in payees.iter().enumerate() {
            require!(!payees[..i].contains(p), "Duplicate payee");
        }
        require!(amount.as_yoctonear() > 0, "Pay must be above zero");
        require!(period_ns.0 > 0, "Period must be above zero");
        require!(periods > 0 && periods <= 520, "Use 1 to 520 periods");
        let payees = payees.into_iter().map(|account| Payee { account, claimed: 0 }).collect();
        let c = Self { funder, payees, amount, period_ns: period_ns.0, periods, start_ns: start_ns.0, funded: false };
        c.total(); // fails now if the total would overflow
        c
    }

    /// The funder deposits exactly the full payroll, once.
    #[payable]
    pub fn deposit(&mut self) {
        require!(!self.funded, "Already funded");
        require!(env::predecessor_account_id() == self.funder, "Only the funder can deposit");
        require!(env::attached_deposit().as_yoctonear() == self.total(), "Attach exactly the full payroll");
        self.funded = true;
    }

    /// A payee pulls every period they have earned and not yet claimed.
    pub fn claim(&mut self) -> Promise {
        require!(self.funded, "Not funded");
        let who = env::predecessor_account_id();
        let idx = self.payees.iter().position(|p| p.account == who).unwrap_or_else(|| env::panic_str("Not a payee"));
        let due = self.elapsed() - self.payees[idx].claimed;
        require!(due > 0, "Nothing to claim");
        self.payees[idx].claimed += due;
        let pay = NearToken::from_yoctonear(self.amount.as_yoctonear() * due as u128);
        Promise::new(who.clone()).transfer(pay).then(Self::ext(env::current_account_id()).on_claim(who, due))
    }

    /// Restores the claim if the transfer failed, so pay is never lost.
    #[private]
    pub fn on_claim(&mut self, account: AccountId, periods: u32, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            if let Some(p) = self.payees.iter_mut().find(|p| p.account == account) {
                p.claimed = p.claimed.saturating_sub(periods);
            }
        }
    }

    pub fn get_claimable(&self, account: AccountId) -> NearToken {
        let claimed = self.payees.iter().find(|p| p.account == account).map(|p| p.claimed).unwrap_or(0);
        let due = if self.funded { self.elapsed() - claimed } else { 0 };
        NearToken::from_yoctonear(self.amount.as_yoctonear() * due as u128)
    }

    pub fn get_rules(&self) -> String {
        format!(
            "{} pays {} payees {} each period for {} periods. Funded once; payees pull their own pay.",
            self.funder,
            self.payees.len(),
            self.amount,
            self.periods
        )
    }

    fn elapsed(&self) -> u32 {
        let now = env::block_timestamp();
        if now < self.start_ns {
            return 0;
        }
        ((now - self.start_ns) / self.period_ns).min(self.periods as u64) as u32
    }

    fn total(&self) -> u128 {
        self.amount
            .as_yoctonear()
            .checked_mul(self.payees.len() as u128 * self.periods as u128)
            .unwrap_or_else(|| env::panic_str("Total overflows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acct(n: &str) -> AccountId {
        n.parse().unwrap()
    }
    fn ctx(who: &str, deposit: NearToken, ts: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("vault.testnet"))
            .predecessor_account_id(acct(who))
            .attached_deposit(deposit)
            .block_timestamp(ts)
            .build());
    }
    // 2 payees, 1 NEAR each period, 3 periods of 100 ns starting at 0: total 6 NEAR.
    fn unfunded() -> PayrollVault {
        ctx("boss.testnet", NearToken::from_near(0), 0);
        PayrollVault::new(
            acct("boss.testnet"),
            vec![acct("ada.testnet"), acct("sam.testnet")],
            NearToken::from_near(1),
            U64(100),
            3,
            U64(0),
        )
    }
    fn funded() -> PayrollVault {
        let mut c = unfunded();
        ctx("boss.testnet", NearToken::from_near(6), 1);
        c.deposit();
        c
    }

    #[test]
    #[should_panic(expected = "Attach exactly the full payroll")]
    fn wrong_total_is_rejected() {
        let mut c = unfunded();
        ctx("boss.testnet", NearToken::from_near(5), 1);
        c.deposit();
    }
    #[test]
    #[should_panic(expected = "Not funded")]
    fn cannot_claim_before_funding() {
        let mut c = unfunded();
        ctx("ada.testnet", NearToken::from_near(0), 500);
        let _ = c.claim();
    }
    #[test]
    #[should_panic(expected = "Nothing to claim")]
    fn nothing_before_first_period() {
        let mut c = funded();
        ctx("ada.testnet", NearToken::from_near(0), 50);
        let _ = c.claim();
    }
    #[test]
    fn claims_earned_periods_once() {
        let mut c = funded();
        ctx("ada.testnet", NearToken::from_near(0), 250);
        assert_eq!(c.get_claimable(acct("ada.testnet")), NearToken::from_near(2));
        let _ = c.claim();
        assert_eq!(c.get_claimable(acct("ada.testnet")), NearToken::from_near(0));
    }
    #[test]
    #[should_panic(expected = "Nothing to claim")]
    fn cannot_double_claim() {
        let mut c = funded();
        ctx("ada.testnet", NearToken::from_near(0), 250);
        let _ = c.claim();
        let _ = c.claim();
    }
    #[test]
    fn pay_stops_after_last_period() {
        let c = funded();
        ctx("ada.testnet", NearToken::from_near(0), 1_000_000);
        assert_eq!(c.get_claimable(acct("sam.testnet")), NearToken::from_near(3));
    }
    #[test]
    #[should_panic(expected = "Not a payee")]
    fn stranger_cannot_claim() {
        let mut c = funded();
        ctx("eve.testnet", NearToken::from_near(0), 250);
        let _ = c.claim();
    }
}
