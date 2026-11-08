//! Real-runtime tests for the revenue split. Run ./build-wasm.sh first, then `cargo test`.
#[path = "../../common/sandbox_common.rs"]
mod common;
use common::*;
use near_workspaces::{network::Sandbox, types::NearToken, Account, Contract, Worker};
use serde_json::json;

struct Env {
    worker: Worker<Sandbox>,
    contract: Contract,
    me: Account,
    sam: Account,
    studio: Account,
    client: Account,
}

async fn env() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let me = make_account(&root, "me", 10).await?;
    let sam = make_account(&root, "sam", 10).await?;
    let studio = make_account(&root, "studio", 10).await?;
    let client = make_account(&root, "client", 50).await?;
    let contract = worker.dev_deploy(&load_wasm("pactsmith_split")).await?;
    contract
        .call("new")
        .args_json(json!({"accounts": [me.id(), sam.id(), studio.id()], "bps": [7000, 2000, 1000]}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(Env { worker, contract, me, sam, studio, client })
}

async fn pay(e: &Env, near: u128) -> anyhow::Result<()> {
    e.client.call(e.contract.id(), "deposit").deposit(NearToken::from_near(near)).max_gas().transact().await?.into_result()?;
    Ok(())
}

async fn withdraw_gain(e: &Env, who: &Account) -> anyhow::Result<i128> {
    let before = bal(&e.worker, who).await?;
    who.call(e.contract.id(), "withdraw").max_gas().transact().await?.into_result()?;
    Ok(diff(bal(&e.worker, who).await?, before))
}

fn near_ish(gained: i128, near: u128) -> bool {
    let n = (near * NEAR) as i128;
    gained > n - (NEAR / 10) as i128 && gained < n + (NEAR / 100) as i128
}

#[tokio::test]
async fn a_payment_is_split_70_20_10_and_withdrawn() -> anyhow::Result<()> {
    let e = env().await?;
    pay(&e, 10).await?;
    assert!(near_ish(withdraw_gain(&e, &e.me).await?, 7));
    assert!(near_ish(withdraw_gain(&e, &e.sam).await?, 2));
    assert!(near_ish(withdraw_gain(&e, &e.studio).await?, 1));
    Ok(())
}

#[tokio::test]
async fn nobody_can_withdraw_twice() -> anyhow::Result<()> {
    let e = env().await?;
    pay(&e, 10).await?;
    withdraw_gain(&e, &e.me).await?;
    let again = e.me.call(e.contract.id(), "withdraw").max_gas().transact().await?;
    assert!(again.is_failure());
    Ok(())
}

#[tokio::test]
async fn a_stranger_cannot_withdraw() -> anyhow::Result<()> {
    let e = env().await?;
    pay(&e, 10).await?;
    let r = e.client.call(e.contract.id(), "withdraw").max_gas().transact().await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn an_empty_payment_is_rejected() -> anyhow::Result<()> {
    let e = env().await?;
    let r = e.client.call(e.contract.id(), "deposit").max_gas().transact().await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn shares_that_do_not_total_100_percent_cannot_initialize() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let a = make_account(&root, "a", 10).await?;
    let b = make_account(&root, "b", 10).await?;
    let contract = worker.dev_deploy(&load_wasm("pactsmith_split")).await?;
    let r = contract
        .call("new")
        .args_json(json!({"accounts": [a.id(), b.id()], "bps": [5000, 4000]}))
        .max_gas()
        .transact()
        .await?;
    assert!(r.is_failure());
    Ok(())
}
