//! Real-runtime tests for the payroll vault. Run ./build-wasm.sh first, then `cargo test`.
#[path = "../../common/sandbox_common.rs"]
mod common;
use common::*;
use near_workspaces::{network::Sandbox, types::NearToken, Account, Contract, Worker};
use serde_json::json;

struct Env {
    worker: Worker<Sandbox>,
    contract: Contract,
    boss: Account,
    ada: Account,
    sam: Account,
    stranger: Account,
    start: u64,
    period_ns: u64,
}

// 2 payees, 1 NEAR per period, 3 periods: the full payroll is 6 NEAR.
async fn env(period_secs: u64) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let boss = make_account(&root, "boss", 50).await?;
    let ada = make_account(&root, "ada", 10).await?;
    let sam = make_account(&root, "sam", 10).await?;
    let stranger = make_account(&root, "stranger", 10).await?;
    let contract = worker.dev_deploy(&load_wasm("pactsmith_payroll")).await?;
    let start = now(&worker).await?;
    let period_ns = period_secs * 1_000_000_000;
    contract
        .call("new")
        .args_json(json!({
            "funder": boss.id(), "payees": [ada.id(), sam.id()], "amount": NEAR.to_string(),
            "period_ns": period_ns.to_string(), "periods": 3, "start_ns": start.to_string()
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(Env { worker, contract, boss, ada, sam, stranger, start, period_ns })
}

async fn fund(e: &Env) -> anyhow::Result<()> {
    e.boss.call(e.contract.id(), "deposit").deposit(NearToken::from_near(6)).max_gas().transact().await?.into_result()?;
    Ok(())
}

async fn claimable(e: &Env, who: &Account) -> anyhow::Result<u128> {
    let s: String = e.contract.view("get_claimable").args_json(json!({"account": who.id()})).await?.json()?;
    Ok(s.parse()?)
}

#[tokio::test]
async fn only_the_exact_full_payroll_is_accepted() -> anyhow::Result<()> {
    let e = env(60).await?;
    let short = e.boss.call(e.contract.id(), "deposit").deposit(NearToken::from_near(5)).max_gas().transact().await?;
    assert!(short.is_failure());
    fund(&e).await?;
    let again = e.boss.call(e.contract.id(), "deposit").deposit(NearToken::from_near(6)).max_gas().transact().await?;
    assert!(again.is_failure(), "a second deposit must be rejected");
    Ok(())
}

#[tokio::test]
async fn nothing_to_claim_before_the_first_period() -> anyhow::Result<()> {
    let e = env(600).await?;
    fund(&e).await?;
    let r = e.ada.call(e.contract.id(), "claim").max_gas().transact().await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn a_stranger_cannot_claim() -> anyhow::Result<()> {
    let e = env(5).await?;
    fund(&e).await?;
    wait_past(&e.worker, e.start + e.period_ns).await?;
    let r = e.stranger.call(e.contract.id(), "claim").max_gas().transact().await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn a_payee_pulls_real_pay_after_a_period() -> anyhow::Result<()> {
    let e = env(5).await?;
    fund(&e).await?;
    wait_past(&e.worker, e.start + e.period_ns).await?;
    let before = bal(&e.worker, &e.ada).await?;
    e.ada.call(e.contract.id(), "claim").max_gas().transact().await?.into_result()?;
    let gained = diff(bal(&e.worker, &e.ada).await?, before);
    assert!(gained > (NEAR * 9 / 10) as i128 && gained < (NEAR * 31 / 10) as i128, "gained {gained}");
    assert!(claimable(&e, &e.sam).await? >= NEAR, "sam's pay must be untouched");
    Ok(())
}

#[tokio::test]
async fn pay_stops_after_the_last_period() -> anyhow::Result<()> {
    let e = env(3).await?;
    fund(&e).await?;
    wait_past(&e.worker, e.start + 3 * e.period_ns).await?;
    let before = bal(&e.worker, &e.sam).await?;
    e.sam.call(e.contract.id(), "claim").max_gas().transact().await?.into_result()?;
    let gained = diff(bal(&e.worker, &e.sam).await?, before);
    assert!(gained > (NEAR * 29 / 10) as i128 && gained < (NEAR * 31 / 10) as i128, "gained {gained}");
    let again = e.sam.call(e.contract.id(), "claim").max_gas().transact().await?;
    assert!(again.is_failure(), "nothing more is owed after all periods");
    Ok(())
}
