//! Pactsmith Revenue Split: every payment is divided the same way, forever.
//! Shares are fixed in basis points (10,000 = 100%). Recipients withdraw their own share.
//! No owner, no admin, no setters. Written from scratch; not audited.
//! Payments must arrive through `deposit`; a plain transfer is not tracked.
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Share {
    pub account: AccountId,
    pub bps: u32,
    pub pending: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RevenueSplit {
    shares: Vec<Share>,
}

#[near]
impl RevenueSplit {
    #[init]
    pub fn new(accounts: Vec<AccountId>, bps: Vec<u32>) -> Self {
        require!(accounts.len() == bps.len(), "One share per account");
        require!(!accounts.is_empty() && accounts.len() <= 20, "Use 1 to 20 recipients");
        for (i, a) in accounts.iter().enumerate() {
            require!(!accounts[..i].contains(a), "Duplicate recipient");
        }
        require!(bps.iter().all(|b| *b > 0), "Every share must be above zero");
        require!(bps.iter().sum::<u32>() == 10_000, "Shares must total 10000");
        let shares = accounts.into_iter().zip(bps).map(|(account, bps)| Share { account, bps, pending: 0 }).collect();
        Self { shares }
    }

    /// Anyone can pay in. The amount is divided by the fixed shares; any leftover
    /// yoctoNEAR from rounding goes to the last recipient, so nothing is lost.
    #[payable]
    pub fn deposit(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach a payment");
        let last = self.shares.len() - 1;
        let mut given = 0u128;
        for (i, s) in self.shares.iter_mut().enumerate() {
            let part = if i == last {
                amount - given
            } else {
                amount.checked_mul(s.bps as u128).unwrap_or_else(|| env::panic_str("Amount too large")) / 10_000
            };
            s.pending += part;
            given += part;
        }
    }

    /// A recipient withdraws everything credited to them.
    pub fn withdraw(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let s = self.shares.iter_mut().find(|s| s.account == who).unwrap_or_else(|| env::panic_str("Not a recipient"));
        require!(s.pending > 0, "Nothing to withdraw");
        let owed = s.pending;
        s.pending = 0;
        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(owed))
            .then(Self::ext(env::current_account_id()).on_withdraw(who, U128(owed)))
    }

    /// Restores the balance if the transfer failed, so funds are never lost.
    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            if let Some(s) = self.shares.iter_mut().find(|s| s.account == account) {
                s.pending += amount.0;
            }
        }
    }

    pub fn get_pending(&self, account: AccountId) -> U128 {
        U128(self.shares.iter().find(|s| s.account == account).map(|s| s.pending).unwrap_or(0))
    }

    pub fn get_shares(&self) -> Vec<Share> {
        self.shares.clone()
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
    fn ctx(who: &str, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("split.testnet"))
            .predecessor_account_id(acct(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }
    fn split(bps: Vec<u32>) -> RevenueSplit {
        ctx("me.testnet", 0);
        let names = ["me.testnet", "sam.testnet", "studio.testnet"];
        let n = bps.len();
        RevenueSplit::new(names[..n].iter().map(|x| acct(x)).collect(), bps)
    }
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    #[test]
    #[should_panic(expected = "Shares must total 10000")]
    fn shares_must_total_100_percent() {
        split(vec![7000, 2000]);
    }
    #[test]
    fn divides_by_shares() {
        let mut c = split(vec![7000, 2000, 1000]);
        ctx("eve.testnet", 10 * NEAR);
        c.deposit();
        assert_eq!(c.get_pending(acct("me.testnet")).0, 7 * NEAR);
        assert_eq!(c.get_pending(acct("sam.testnet")).0, 2 * NEAR);
        assert_eq!(c.get_pending(acct("studio.testnet")).0, NEAR);
    }
    #[test]
    fn rounding_leftover_is_not_lost() {
        let mut c = split(vec![3333, 3333, 3334]);
        ctx("eve.testnet", 100);
        c.deposit();
        let sum: u128 = ["me", "sam", "studio"].iter().map(|n| c.get_pending(acct(&format!("{n}.testnet"))).0).sum();
        assert_eq!(sum, 100);
    }
    #[test]
    fn recipient_withdraws_once() {
        let mut c = split(vec![7000, 3000]);
        ctx("eve.testnet", NEAR);
        c.deposit();
        ctx("sam.testnet", 0);
        let _ = c.withdraw();
        assert_eq!(c.get_pending(acct("sam.testnet")).0, 0);
    }
    #[test]
    #[should_panic(expected = "Nothing to withdraw")]
    fn cannot_withdraw_twice() {
        let mut c = split(vec![7000, 3000]);
        ctx("eve.testnet", NEAR);
        c.deposit();
        ctx("sam.testnet", 0);
        let _ = c.withdraw();
        let _ = c.withdraw();
    }
    #[test]
    #[should_panic(expected = "Not a recipient")]
    fn stranger_cannot_withdraw() {
        let mut c = split(vec![7000, 3000]);
        ctx("eve.testnet", 0);
        let _ = c.withdraw();
    }
}
