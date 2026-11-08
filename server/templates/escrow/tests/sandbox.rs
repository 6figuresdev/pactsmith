//! Real-runtime tests for the escrow. Run ./build-wasm.sh first, then `cargo test`.
#[path = "../../common/sandbox_common.rs"]
mod common;
use common::*;
use near_workspaces::{network::Sandbox, types::NearToken, Account, Contract, Worker};
use serde_json::json;

struct Env {
    worker: Worker<Sandbox>,
    contract: Contract,
    payer: Account,
    payee: Account,
    stranger: Account,
    deadline: u64,
}

async fn env(payee_override: Option<&str>, deadline_secs: u64) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let payer = make_account(&root, "payer", 50).await?;
    let payee = make_account(&root, "payee", 10).await?;
    let stranger = make_account(&root, "stranger", 10).await?;
    let contract = worker.dev_deploy(&load_wasm("pactsmith_escrow")).await?;
    let deadline = now(&worker).await? + deadline_secs * 1_000_000_000;
    let payee_arg = match payee_override {
        Some(p) => json!(p),
        None => json!(payee.id()),
    };
    contract
        .call("new")
        .args_json(json!({
            "payer": payer.id(), "payee": payee_arg,
            "amount": (5 * NEAR).to_string(), "deadline_ns": deadline.to_string()
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(Env { worker, contract, payer, payee, stranger, deadline })
}

async fn fund(e: &Env) -> anyhow::Result<()> {
    e.payer
        .call(e.contract.id(), "deposit")
        .deposit(NearToken::from_near(5))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn status(e: &Env) -> anyhow::Result<String> {
    Ok(e.contract.view("get_status").await?.json()?)
}

#[tokio::test]
async fn release_pays_the_payee_real_money() -> anyhow::Result<()> {
    let e = env(None, 600).await?;
    fund(&e).await?;
    let before = bal(&e.worker, &e.payee).await?;
    e.payer.call(e.contract.id(), "release").max_gas().transact().await?.into_result()?;
    assert_eq!(diff(bal(&e.worker, &e.payee).await?, before), (5 * NEAR) as i128);
    assert_eq!(status(&e).await?, "Released");
    Ok(())
}

#[tokio::test]
async fn failed_payout_keeps_the_money_and_status() -> anyhow::Result<()> {
    // The payee account does not exist, so the transfer fails and must be rolled back.
    let e = env(Some("ghost.test.near"), 600).await?;
    fund(&e).await?;
    let before = bal(&e.worker, e.contract.as_account()).await?;
    let _ = e.payer.call(e.contract.id(), "release").max_gas().transact().await?;
    assert_eq!(status(&e).await?, "Funded");
    assert!(bal(&e.worker, e.contract.as_account()).await? + NEAR / 100 >= before);
    Ok(())
}

#[tokio::test]
async fn only_the_payer_can_release() -> anyhow::Result<()> {
    let e = env(None, 600).await?;
    fund(&e).await?;
    let r = e.payee.call(e.contract.id(), "release").max_gas().transact().await?;
    assert!(r.is_failure());
    assert_eq!(status(&e).await?, "Funded");
    Ok(())
}

#[tokio::test]
async fn wrong_deposit_is_rejected_and_returned() -> anyhow::Result<()> {
    let e = env(None, 600).await?;
    let before = bal(&e.worker, &e.payer).await?;
    let r = e.payer.call(e.contract.id(), "deposit").deposit(NearToken::from_near(4)).max_gas().transact().await?;
    assert!(r.is_failure());
    assert!(diff(before, bal(&e.worker, &e.payer).await?) < (NEAR / 10) as i128, "deposit was not returned");
    assert_eq!(status(&e).await?, "Created");
    Ok(())
}

#[tokio::test]
async fn a_stranger_cannot_deposit() -> anyhow::Result<()> {
    let e = env(None, 600).await?;
    let r = e.stranger.call(e.contract.id(), "deposit").deposit(NearToken::from_near(5)).max_gas().transact().await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn refund_works_only_after_the_deadline() -> anyhow::Result<()> {
    let e = env(None, 8).await?;
    fund(&e).await?;
    let early = e.stranger.call(e.contract.id(), "refund").max_gas().transact().await?;
    assert!(early.is_failure(), "refund must fail before the deadline");
    wait_past(&e.worker, e.deadline).await?;
    let before = bal(&e.worker, &e.payer).await?;
    e.stranger.call(e.contract.id(), "refund").max_gas().transact().await?.into_result()?;
    assert_eq!(diff(bal(&e.worker, &e.payer).await?, before), (5 * NEAR) as i128);
    assert_eq!(status(&e).await?, "Refunded");
    Ok(())
}

#[tokio::test]
async fn a_past_deadline_cannot_initialize() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let a = make_account(&root, "a", 10).await?;
    let b = make_account(&root, "b", 10).await?;
    let contract = worker.dev_deploy(&load_wasm("pactsmith_escrow")).await?;
    let r = contract
        .call("new")
        .args_json(json!({"payer": a.id(), "payee": b.id(), "amount": NEAR.to_string(), "deadline_ns": "1"}))
        .max_gas()
        .transact()
        .await?;
    assert!(r.is_failure());
    Ok(())
}
