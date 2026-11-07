//! Shared helpers for the sandbox tests. Each test starts its own local NEAR network.
#![allow(dead_code)]
use near_workspaces::{network::Sandbox, types::NearToken, Account, Worker};
use std::{path::{Path, PathBuf}, time::{Duration, SystemTime, UNIX_EPOCH}};

pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// Finds the newest `<crate_name>.wasm` that `cargo near build` produced under ./target.
pub fn load_wasm(crate_name: &str) -> Vec<u8> {
    let file = format!("{crate_name}.wasm");
    let mut stack = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target")];
    let mut best: Option<(SystemTime, PathBuf)> = None;
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if p.is_dir() {
                if name != "deps" && name != "incremental" && name != "build" {
                    stack.push(p);
                }
            } else if name == file {
                let t = e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH);
                if best.as_ref().map_or(true, |(b, _)| t > *b) {
                    best = Some((t, p));
                }
            }
        }
    }
    let (_, path) = best.unwrap_or_else(|| {
        panic!("{file} not found under ./target. Build it first with: ./build-wasm.sh")
    });
    std::fs::read(path).expect("could not read wasm file")
}

pub async fn now(w: &Worker<Sandbox>) -> anyhow::Result<u64> {
    Ok(w.view_block().await?.timestamp())
}

/// Waits (in real time) until the sandbox clock is past `ts` nanoseconds.
pub async fn wait_past(w: &Worker<Sandbox>, ts: u64) -> anyhow::Result<()> {
    for _ in 0..90 {
        if now(w).await? > ts {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
        w.fast_forward(2).await?;
    }
    anyhow::bail!("sandbox clock never passed the deadline")
}

pub async fn make_account(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_yoctonear(near * NEAR))
        .transact()
        .await?
        .into_result()?)
}

/// Reads a balance only after the network has caught up (two equal reads in a row).
pub async fn bal(w: &Worker<Sandbox>, a: &Account) -> anyhow::Result<u128> {
    let mut last = a.view_account().await?.balance.as_yoctonear();
    for _ in 0..10 {
        w.fast_forward(2).await?;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let cur = a.view_account().await?.balance.as_yoctonear();
        if cur == last {
            return Ok(cur);
        }
        last = cur;
    }
    Ok(last)
}

pub fn diff(after: u128, before: u128) -> i128 {
    after as i128 - before as i128
}
