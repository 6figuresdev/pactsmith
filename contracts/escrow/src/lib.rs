//! Pactsmith Escrow: one payer, one payee, one exact amount of NEAR.
//! No owner, no admin, no setters. Written from scratch; not audited.
use near_sdk::json_types::U64;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Created,
    Funded,
    Released,
    Refunded,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    payer: AccountId,
    payee: AccountId,
    amount: NearToken,
    deadline_ns: u64,
    status: Status,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(payer: AccountId, payee: AccountId, amount: NearToken, deadline_ns: U64) -> Self {
        require!(payer != payee, "Payer and payee must differ");
        require!(amount.as_yoctonear() > 0, "Amount must be above zero");
        require!(deadline_ns.0 > env::block_timestamp(), "Deadline must be in the future");
        Self { payer, payee, amount, deadline_ns: deadline_ns.0, status: Status::Created }
    }

    /// The payer funds the escrow once, with exactly the agreed amount.
    #[payable]
    pub fn deposit(&mut self) {
        require!(self.status == Status::Created, "Already funded");
        require!(env::predecessor_account_id() == self.payer, "Only the payer can deposit");
        require!(env::attached_deposit() == self.amount, "Attach exactly the agreed amount");
        self.status = Status::Funded;
    }

    /// Only the payer can release funds to the payee.
    pub fn release(&mut self) -> Promise {
        require!(env::predecessor_account_id() == self.payer, "Only the payer can release");
        self.pay_out(self.payee.clone(), Status::Released)
    }

    /// The payee can hand the money back at any time.
    pub fn return_to_payer(&mut self) -> Promise {
        require!(env::predecessor_account_id() == self.payee, "Only the payee can return funds");
        self.pay_out(self.payer.clone(), Status::Refunded)
    }

    /// After the deadline, anyone can send the money back to the payer.
    pub fn refund(&mut self) -> Promise {
        require!(env::block_timestamp() >= self.deadline_ns, "Deadline not reached");
        self.pay_out(self.payer.clone(), Status::Refunded)
    }

    /// Reverts the status if a transfer failed, so funds are never stranded.
    #[private]
    pub fn on_payout(&mut self, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.status = Status::Funded;
        }
    }

    pub fn get_status(&self) -> Status {
        self.status
    }

    pub fn get_rules(&self) -> String {
        format!(
            "{} holds {} for {}. Only the payer releases. The payee may return it. After {} ns anyone may refund the payer.",
            self.payer, self.amount, self.payee, self.deadline_ns
        )
    }

    fn pay_out(&mut self, to: AccountId, next: Status) -> Promise {
        require!(self.status == Status::Funded, "Escrow is not funded");
        self.status = next;
        Promise::new(to)
            .transfer(self.amount)
            .then(Self::ext(env::current_account_id()).on_payout())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const DEADLINE: u64 = 1_000;

    fn acct(n: &str) -> AccountId {
        n.parse().unwrap()
    }
    fn ctx(who: &str, deposit: NearToken, ts: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("pact.testnet"))
            .predecessor_account_id(acct(who))
            .attached_deposit(deposit)
            .block_timestamp(ts)
            .build());
    }
    fn funded() -> Escrow {
        ctx("payer.testnet", NearToken::from_near(0), 1);
        let mut c = Escrow::new(acct("payer.testnet"), acct("ada.testnet"), NearToken::from_near(5), U64(DEADLINE));
        ctx("payer.testnet", NearToken::from_near(5), 2);
        c.deposit();
        c
    }

    #[test]
    fn payer_deposits_exact_amount() {
        assert_eq!(funded().get_status(), Status::Funded);
    }
    #[test]
    #[should_panic(expected = "Attach exactly")]
    fn wrong_amount_is_rejected() {
        ctx("payer.testnet", NearToken::from_near(0), 1);
        let mut c = Escrow::new(acct("payer.testnet"), acct("ada.testnet"), NearToken::from_near(5), U64(DEADLINE));
        ctx("payer.testnet", NearToken::from_near(4), 2);
        c.deposit();
    }
    #[test]
    #[should_panic(expected = "Only the payer can deposit")]
    fn stranger_cannot_deposit() {
        ctx("payer.testnet", NearToken::from_near(0), 1);
        let mut c = Escrow::new(acct("payer.testnet"), acct("ada.testnet"), NearToken::from_near(5), U64(DEADLINE));
        ctx("eve.testnet", NearToken::from_near(5), 2);
        c.deposit();
    }
    #[test]
    fn payer_releases() {
        let mut c = funded();
        ctx("payer.testnet", NearToken::from_near(0), 3);
        let _ = c.release();
        assert_eq!(c.get_status(), Status::Released);
    }
    #[test]
    #[should_panic(expected = "Only the payer can release")]
    fn payee_cannot_release() {
        let mut c = funded();
        ctx("ada.testnet", NearToken::from_near(0), 3);
        let _ = c.release();
    }
    #[test]
    fn payee_can_return() {
        let mut c = funded();
        ctx("ada.testnet", NearToken::from_near(0), 3);
        let _ = c.return_to_payer();
        assert_eq!(c.get_status(), Status::Refunded);
    }
    #[test]
    #[should_panic(expected = "Deadline not reached")]
    fn no_refund_before_deadline() {
        let mut c = funded();
        ctx("eve.testnet", NearToken::from_near(0), 500);
        let _ = c.refund();
    }
    #[test]
    fn anyone_refunds_after_deadline() {
        let mut c = funded();
        ctx("eve.testnet", NearToken::from_near(0), DEADLINE + 1);
        let _ = c.refund();
        assert_eq!(c.get_status(), Status::Refunded);
    }
    #[test]
    #[should_panic(expected = "Escrow is not funded")]
    fn cannot_pay_out_twice() {
        let mut c = funded();
        ctx("payer.testnet", NearToken::from_near(0), 3);
        let _ = c.release();
        let _ = c.release();
    }
}
