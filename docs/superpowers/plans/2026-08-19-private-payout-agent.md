# Private Payout Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a co-pilot agent that funds N recipients privately in one Starknet transaction and lets each recipient claim into their own private note, with per-recipient amounts hidden until claim.

**Architecture:** A pure-TypeScript planner turns a payroll intent into a privacy-shaped plan; an escrow client turns that plan into `STRK20_ACTION[]` batches; a stateful Cairo anonymizer (`PayrollEscrow`) holds the funds and releases them against Poseidon commitments. The app never holds keys — the user's wallet signs every transaction.

**Tech Stack:** Next.js 16 + React 19, starknet.js 10.4.0 (`WalletAccountV6`), Cairo 2.16 / Scarb 2.16.0, snforge 0.56.0, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-shadowagents-payroll-design.md`

## Global Constraints

- Network: Starknet **mainnet**, `CHAIN_ID = SN_MAIN`. Pool address `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.
- Pool fee is **6 STRK per private operation** (read live from `get_fee_amount`; never hardcode in shipped code).
- RPC key lives only in `.env.local` (gitignored) as `NEXT_PUBLIC_PROVIDER_URL` — the Alchemy **key only**, never the full URL, never committed.
- The Cairo contract is a **DRAFT**: it must pass the audit task (Task 8) before any mainnet deploy. Every file header says so.
- Never ask the user for a viewing key. Never attribute pool activity to a transaction's sender.
- Calldata order must match `privacy_invoke`'s parameter order exactly.
- Commitment tag is the short string `SA_PAYROLL_V1` (felt `0x53415f504159524f4c4c5f5631`) in both Cairo and TypeScript.
- Commit after every task. Push after every task. **No `Co-Authored-By: Claude` trailer.**

---

### Task 1: Cairo package + commitment hash

**Files:**
- Create: `cairo-payroll/Scarb.toml`
- Create: `cairo-payroll/src/lib.cairo`
- Create: `cairo-payroll/tests/test_hash.cairo`
- Create: `cairo-payroll/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `compute_commitment_hash(secret: felt252, amount: u128) -> felt252`, `PAYROLL_COMMITMENT_TAG: felt252`, structs `OpenNoteDeposit { note_id: felt252, token: ContractAddress, amount: u128 }`, `Batch { token: ContractAddress, remaining: u128 }`, `Commit { batch_id: felt252, claimed: bool }`, enum `PayrollOperation { Fund, Claim }`.

- [ ] **Step 1: Create the package manifest**

`cairo-payroll/Scarb.toml`:
```toml
[package]
name = "payroll_escrow"
version = "0.1.0"
edition = "2024_07"

[dependencies]
starknet = "2.16.0"

[dev-dependencies]
snforge_std = "0.56.0"

[[target.starknet-contract]]
sierra = true
casm = true
```

`cairo-payroll/.gitignore`:
```
target/
.snfoundry_cache/
```

- [ ] **Step 2: Write the failing test**

`cairo-payroll/tests/test_hash.cairo`:
```cairo
use payroll_escrow::{PAYROLL_COMMITMENT_TAG, compute_commitment_hash};

#[test]
fn tag_is_the_versioned_short_string() {
    assert(PAYROLL_COMMITMENT_TAG == 'SA_PAYROLL_V1', 'wrong tag');
}

#[test]
fn hash_binds_both_secret_and_amount() {
    let a = compute_commitment_hash(42, 100);
    assert(a != compute_commitment_hash(43, 100), 'secret not bound');
    assert(a != compute_commitment_hash(42, 101), 'amount not bound');
    assert(a == compute_commitment_hash(42, 100), 'not deterministic');
}

// Prints the vector the TypeScript parity test in Task 5 asserts against.
#[test]
fn print_parity_vector() {
    println!("PARITY secret=42 amount=100 -> {}", compute_commitment_hash(42, 100));
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd cairo-payroll && snforge test`
Expected: FAIL — `payroll_escrow` has no `lib.cairo` yet (unresolved import).

- [ ] **Step 4: Write the minimal implementation**

`cairo-payroll/src/lib.cairo`:
```cairo
//! PayrollEscrow — DRAFT anonymizer for the STRK20 privacy pool.
//!
//! NOT AUDITED. This adapts an unofficial escrow illustration, not a shipped
//! StarkWare package. It must pass review and audit before any mainnet deploy.

use starknet::ContractAddress;

/// Must match `privacy::objects::OpenNoteDeposit` (positional Serde).
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Which leg of the escrow the pool is driving.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum PayrollOperation {
    Fund,
    Claim,
}

/// One funded payroll batch. `remaining` shrinks as recipients claim.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct Batch {
    pub token: ContractAddress,
    pub remaining: u128,
}

/// One recipient slot, addressed by its commitment hash.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct Commit {
    pub batch_id: felt252,
    pub claimed: bool,
}

/// Domain separation, versioned so a future scheme cannot collide with this one.
pub const PAYROLL_COMMITMENT_TAG: felt252 = 'SA_PAYROLL_V1';

/// The amount is inside the preimage, so funding calldata carries no amounts.
pub fn compute_commitment_hash(secret: felt252, amount: u128) -> felt252 {
    core::poseidon::poseidon_hash_span(
        [PAYROLL_COMMITMENT_TAG, secret, amount.into()].span(),
    )
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd cairo-payroll && snforge test`
Expected: PASS (3 tests). Record the printed parity vector — Task 5 asserts on it.

- [ ] **Step 6: Commit and push**

```bash
git add cairo-payroll
git commit -m "feat(cairo): payroll escrow package with domain-separated commitment hash"
git push origin main
```

---

### Task 2: PayrollEscrow — Fund leg

**Files:**
- Modify: `cairo-payroll/src/lib.cairo` (append the contract module)
- Create: `cairo-payroll/tests/test_fund.cairo`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: contract `PayrollEscrow` with `constructor(privacy_contract: ContractAddress)`, and trait `IPayrollEscrow<T>` exposing `get_batch(batch_id: felt252) -> Batch`, `get_commit(commitment_hash: felt252) -> Commit`, `get_accounted(token: ContractAddress) -> u128`, and `privacy_invoke(operation, batch_id, token, secret, amount, note_id, commitments: Span<felt252>) -> Span<OpenNoteDeposit>`.

- [ ] **Step 1: Write the failing test**

`cairo-payroll/tests/test_fund.cairo`:
```cairo
use payroll_escrow::{
    Batch, Commit, IPayrollEscrowDispatcher, IPayrollEscrowDispatcherTrait, PayrollOperation,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address};
use starknet::ContractAddress;

fn POOL() -> ContractAddress {
    0x1234.try_into().unwrap()
}

/// Deploys a mintable ERC-20 mock and the escrow, then funds the escrow with `amount`.
fn setup(amount: u256) -> (IPayrollEscrowDispatcher, ContractAddress) {
    let erc20 = declare("MockErc20").unwrap().contract_class();
    let (token, _) = erc20.deploy(@array![]).unwrap();

    let escrow_class = declare("PayrollEscrow").unwrap().contract_class();
    let (escrow_addr, _) = escrow_class.deploy(@array![POOL().into()]).unwrap();

    // The pool transfers the tokens in before calling privacy_invoke.
    let minter = IMockErc20Dispatcher { contract_address: token };
    minter.mint(escrow_addr, amount);

    (IPayrollEscrowDispatcher { contract_address: escrow_addr }, token)
}

#[test]
fn fund_records_batch_and_commitments() {
    let (escrow, token) = setup(30);
    start_cheat_caller_address(escrow.contract_address, POOL());

    let out = escrow
        .privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h1', 'h2'].span());

    assert(out.len() == 0, 'fund credits nothing');
    assert(escrow.get_batch('b1') == Batch { token, remaining: 30 }, 'batch wrong');
    assert(escrow.get_commit('h1') == Commit { batch_id: 'b1', claimed: false }, 'h1 wrong');
    assert(escrow.get_commit('h2') == Commit { batch_id: 'b1', claimed: false }, 'h2 wrong');
    assert(escrow.get_accounted(token) == 30, 'accounted wrong');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn fund_rejects_a_caller_that_is_not_the_pool() {
    let (escrow, token) = setup(30);
    start_cheat_caller_address(escrow.contract_address, 0xdead.try_into().unwrap());
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h1'].span());
}

#[test]
#[should_panic(expected: 'BATCH_EXISTS')]
fn fund_rejects_a_reused_batch_id() {
    let (escrow, token) = setup(30);
    start_cheat_caller_address(escrow.contract_address, POOL());
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h1'].span());
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h2'].span());
}

#[test]
#[should_panic(expected: 'NO_INPUT')]
fn fund_rejects_when_no_new_tokens_arrived() {
    let (escrow, token) = setup(30);
    start_cheat_caller_address(escrow.contract_address, POOL());
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h1'].span());
    // Second batch with no fresh transfer: balance == accounted, so nothing to fund.
    escrow.privacy_invoke(PayrollOperation::Fund, 'b2', token, 0, 0, 0, array!['h2'].span());
}
```

Add the mock the tests declare, in `cairo-payroll/src/mock_erc20.cairo`:
```cairo
//! Test-only mintable ERC-20. Not deployed to any live network.
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockErc20<T> {
    fn mint(ref self: T, to: ContractAddress, amount: u256);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
}

#[starknet::contract]
pub mod MockErc20 {
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePathEntry, Map,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl MockImpl of super::IMockErc20<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }
        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }
    }
}
```

Register it by adding `pub mod mock_erc20;` at the top of `src/lib.cairo`, and import the dispatcher in the test with `use payroll_escrow::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cairo-payroll && snforge test test_fund`
Expected: FAIL — `PayrollEscrow` and `IPayrollEscrowDispatcher` do not exist.

- [ ] **Step 3: Implement the contract with only the Fund leg**

Append to `cairo-payroll/src/lib.cairo`:
```cairo
#[starknet::interface]
pub trait IPayrollEscrow<T> {
    fn get_batch(self: @T, batch_id: felt252) -> Batch;
    fn get_commit(self: @T, commitment_hash: felt252) -> Commit;
    fn get_accounted(self: @T, token: ContractAddress) -> u128;
    /// Called by the privacy pool through its INVOKE_SELECTOR.
    fn privacy_invoke(
        ref self: T,
        operation: PayrollOperation,
        batch_id: felt252,
        token: ContractAddress,
        secret: felt252,
        amount: u128,
        note_id: felt252,
        commitments: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::interface]
pub trait IErc20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

pub mod errors {
    pub const CALLER_NOT_PRIVACY: felt252 = 'CALLER_NOT_PRIVACY';
    pub const ZERO_BATCH_ID: felt252 = 'ZERO_BATCH_ID';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const NO_COMMITMENTS: felt252 = 'NO_COMMITMENTS';
    pub const BATCH_EXISTS: felt252 = 'BATCH_EXISTS';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const INSUFFICIENT_BATCH: felt252 = 'INSUFFICIENT_BATCH';
    pub const NO_INPUT: felt252 = 'NO_INPUT';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
}

#[starknet::contract]
pub mod PayrollEscrow {
    use core::num::traits::Zero;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        Batch, Commit, IErc20Dispatcher, IErc20DispatcherTrait, IPayrollEscrow, OpenNoteDeposit,
        PayrollOperation, compute_commitment_hash, errors,
    };

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
        batches: Map<felt252, Batch>,
        commitments: Map<felt252, Commit>,
        /// Per-token total already promised to live batches — the baseline the
        /// balance delta is measured against, because this helper holds funds
        /// across transactions and has no "before" snapshot to read.
        accounted: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Funded: Funded,
        Claimed: Claimed,
    }

    #[derive(Drop, starknet::Event)]
    struct Funded {
        #[key]
        batch_id: felt252,
        token: ContractAddress,
        amount: u128,
        count: u32,
    }

    #[derive(Drop, starknet::Event)]
    struct Claimed {
        #[key]
        batch_id: felt252,
        token: ContractAddress,
        amount: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_contract: ContractAddress) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_TOKEN);
        self.privacy_contract.write(privacy_contract);
    }

    #[abi(embed_v0)]
    pub impl PayrollEscrowImpl of IPayrollEscrow<ContractState> {
        fn get_batch(self: @ContractState, batch_id: felt252) -> Batch {
            self.batches.read(batch_id)
        }

        fn get_commit(self: @ContractState, commitment_hash: felt252) -> Commit {
            self.commitments.read(commitment_hash)
        }

        fn get_accounted(self: @ContractState, token: ContractAddress) -> u128 {
            self.accounted.read(token)
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: PayrollOperation,
            batch_id: felt252,
            token: ContractAddress,
            secret: felt252,
            amount: u128,
            note_id: felt252,
            commitments: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            let privacy_addr = self.privacy_contract.read();
            assert(get_caller_address() == privacy_addr, errors::CALLER_NOT_PRIVACY);

            match operation {
                PayrollOperation::Fund => {
                    assert(batch_id.is_non_zero(), errors::ZERO_BATCH_ID);
                    assert(token.is_non_zero(), errors::ZERO_TOKEN);
                    assert(commitments.len() != 0, errors::NO_COMMITMENTS);
                    assert(self.batches.read(batch_id).token.is_zero(), errors::BATCH_EXISTS);

                    // Balance delta against the stored baseline: the pool has already
                    // transferred the funds in (phase order puts withdraw before invoke).
                    let raw: u256 = IErc20Dispatcher { contract_address: token }
                        .balance_of(get_contract_address());
                    let balance: u128 = raw.try_into().expect(errors::AMOUNT_OVERFLOW);
                    let accounted = self.accounted.read(token);
                    assert(balance > accounted, errors::NO_INPUT);
                    let funded = balance - accounted;

                    self.batches.write(batch_id, Batch { token, remaining: funded });
                    self.accounted.write(token, accounted + funded);

                    let mut i: u32 = 0;
                    while i != commitments.len() {
                        let h = *commitments.at(i);
                        assert(h.is_non_zero(), errors::ZERO_COMMITMENT);
                        assert(
                            self.commitments.read(h).batch_id.is_zero(),
                            errors::COMMITMENT_EXISTS,
                        );
                        self.commitments.write(h, Commit { batch_id, claimed: false });
                        i += 1;
                    }

                    self
                        .emit(
                            Funded { batch_id, token, amount: funded, count: commitments.len() },
                        );
                    // Funds stay parked; there is nothing for the pool to credit yet.
                    [].span()
                },
                PayrollOperation::Claim => {
                    // Implemented in Task 3.
                    let _ = (secret, amount, note_id);
                    [].span()
                },
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd cairo-payroll && snforge test test_fund`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit and push**

```bash
git add cairo-payroll
git commit -m "feat(cairo): PayrollEscrow fund leg with per-batch isolation"
git push origin main
```

---

### Task 3: PayrollEscrow — Claim leg

**Files:**
- Modify: `cairo-payroll/src/lib.cairo` (replace the `PayrollOperation::Claim` arm)
- Create: `cairo-payroll/tests/test_claim.cairo`

**Interfaces:**
- Consumes: `IPayrollEscrowDispatcher`, `compute_commitment_hash`, `Batch`, `Commit` from Tasks 1–2.
- Produces: a working Claim leg returning exactly one `OpenNoteDeposit`.

- [ ] **Step 1: Write the failing test**

`cairo-payroll/tests/test_claim.cairo`:
```cairo
use payroll_escrow::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use payroll_escrow::{
    IPayrollEscrowDispatcher, IPayrollEscrowDispatcherTrait, PayrollOperation,
    compute_commitment_hash,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address};
use starknet::ContractAddress;

fn POOL() -> ContractAddress {
    0x1234.try_into().unwrap()
}

/// Escrow funded with `total`, carrying one commitment for (secret, amount).
fn funded(total: u256, secret: felt252, amount: u128) -> (IPayrollEscrowDispatcher, ContractAddress) {
    let erc20 = declare("MockErc20").unwrap().contract_class();
    let (token, _) = erc20.deploy(@array![]).unwrap();
    let escrow_class = declare("PayrollEscrow").unwrap().contract_class();
    let (addr, _) = escrow_class.deploy(@array![POOL().into()]).unwrap();
    IMockErc20Dispatcher { contract_address: token }.mint(addr, total);

    let escrow = IPayrollEscrowDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, POOL());
    let h = compute_commitment_hash(secret, amount);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array![h].span());
    (escrow, token)
}

#[test]
fn claim_credits_an_open_note_and_approves_the_pool() {
    let (escrow, token) = funded(30, 'sec', 12);

    let out = escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'sec', 12, 'note1', array![].span());

    assert(out.len() == 1, 'one deposit expected');
    let d = *out.at(0);
    assert(d.note_id == 'note1', 'note id wrong');
    assert(d.token == token, 'token wrong');
    assert(d.amount == 12, 'amount wrong');
    assert(escrow.get_batch('b1').remaining == 18, 'remaining wrong');
    assert(escrow.get_accounted(token) == 18, 'accounted wrong');
    let allowance = IMockErc20Dispatcher { contract_address: token }
        .allowance(escrow.contract_address, POOL());
    assert(allowance == 12, 'pool not approved');
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_commitment_cannot_be_claimed_twice() {
    let (escrow, _) = funded(30, 'sec', 12);
    escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'sec', 12, 'n1', array![].span());
    escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'sec', 12, 'n2', array![].span());
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn a_wrong_secret_finds_nothing() {
    let (escrow, _) = funded(30, 'sec', 12);
    escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'nope', 12, 'n1', array![].span());
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn the_right_secret_with_a_wrong_amount_finds_nothing() {
    let (escrow, _) = funded(30, 'sec', 12);
    escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'sec', 13, 'n1', array![].span());
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BATCH')]
fn a_claim_cannot_exceed_what_its_batch_holds() {
    // Funded with 10 but the commitment promises 12 — over-registration by the employer.
    let (escrow, _) = funded(10, 'sec', 12);
    escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'sec', 12, 'n1', array![].span());
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn claim_rejects_a_caller_that_is_not_the_pool() {
    let (escrow, _) = funded(30, 'sec', 12);
    start_cheat_caller_address(escrow.contract_address, 0xdead.try_into().unwrap());
    escrow.privacy_invoke(PayrollOperation::Claim, 0, 0.try_into().unwrap(), 'sec', 12, 'n1', array![].span());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cairo-payroll && snforge test test_claim`
Expected: FAIL — the Claim arm returns an empty span, so `out.len() == 1` fails.

- [ ] **Step 3: Implement the Claim leg**

Replace the `PayrollOperation::Claim` arm in `src/lib.cairo` with:
```cairo
                PayrollOperation::Claim => {
                    assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

                    // Only the preimage matters; the hash is recomputed, never trusted.
                    let h = compute_commitment_hash(secret, amount);
                    let commit = self.commitments.read(h);
                    assert(commit.batch_id.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
                    assert(!commit.claimed, errors::ALREADY_CLAIMED);

                    let batch = self.batches.read(commit.batch_id);
                    assert(batch.remaining >= amount, errors::INSUFFICIENT_BATCH);

                    self.commitments.write(h, Commit { claimed: true, ..commit });
                    self
                        .batches
                        .write(
                            commit.batch_id,
                            Batch { remaining: batch.remaining - amount, ..batch },
                        );
                    self
                        .accounted
                        .write(batch.token, self.accounted.read(batch.token) - amount);

                    // Approve, never transfer — the pool pulls when it applies the deposit.
                    IErc20Dispatcher { contract_address: batch.token }
                        .approve(privacy_addr, amount.into());

                    self
                        .emit(
                            Claimed {
                                batch_id: commit.batch_id, token: batch.token, amount,
                            },
                        );
                    [OpenNoteDeposit { note_id, token: batch.token, amount }].span()
                },
```

Also delete the now-unused `let _ = (secret, amount, note_id);` line and the `token` parameter's Fund-only comment if it conflicts.

- [ ] **Step 4: Run the whole Cairo suite**

Run: `cd cairo-payroll && snforge test`
Expected: PASS (all tests from Tasks 1–3, 13 total).

- [ ] **Step 5: Commit and push**

```bash
git add cairo-payroll
git commit -m "feat(cairo): PayrollEscrow claim leg with double-claim and over-claim guards"
git push origin main
```

---

### Task 4: Planner — amount splitting and claim scheduling

**Files:**
- Create: `src/lib/planner/split.ts`
- Create: `src/lib/planner/schedule.ts`
- Create: `src/lib/planner/types.ts`
- Create: `src/lib/planner/split.test.ts`
- Create: `src/lib/planner/schedule.test.ts`
- Modify: `package.json` (add Vitest and the `test` script)
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Rng = () => number`; `splitAmounts(total: bigint, n: number, rng: Rng): bigint[]`; `scheduleClaims(n: number, windowMinutes: number, rng: Rng): number[]` (minute offsets, ascending); `type PayoutPlan = { recipients: { label: string; amount: bigint; offsetMinutes: number }[]; total: bigint }`.

- [ ] **Step 1: Add the test runner**

```bash
npm install -D vitest@^3.2.4
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Add to `package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing tests**

`src/lib/planner/split.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { splitAmounts } from "./split";

// Deterministic RNG so a failure is reproducible.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ONE = 10n ** 18n;

describe("splitAmounts", () => {
  it("sums to exactly the total", () => {
    for (let n = 2; n <= 8; n++) {
      const parts = splitAmounts(30n * ONE, n, seeded(n));
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(30n * ONE);
    }
  });

  it("returns one positive amount per recipient", () => {
    const parts = splitAmounts(30n * ONE, 5, seeded(7));
    expect(parts).toHaveLength(5);
    for (const p of parts) expect(p > 0n).toBe(true);
  });

  it("avoids round amounts, which are the strongest fingerprint", () => {
    const parts = splitAmounts(30n * ONE, 3, seeded(11));
    // No part is a whole number of tokens.
    for (const p of parts) expect(p % ONE).not.toBe(0n);
  });

  it("rejects a split that cannot give everyone a positive amount", () => {
    expect(() => splitAmounts(2n, 5, seeded(1))).toThrow(/too small/i);
  });
});
```

`src/lib/planner/schedule.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { scheduleClaims } from "./schedule";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("scheduleClaims", () => {
  it("returns ascending offsets inside the window", () => {
    const offsets = scheduleClaims(5, 120, seeded(3));
    expect(offsets).toHaveLength(5);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
    expect(offsets[offsets.length - 1]).toBeLessThanOrEqual(120);
    expect(offsets[0]).toBeGreaterThan(0);
  });

  it("spreads non-uniformly, so gaps are not all equal", () => {
    const offsets = scheduleClaims(6, 180, seeded(5));
    const gaps = offsets.slice(1).map((o, i) => o - offsets[i]);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — `./split` and `./schedule` do not exist.

- [ ] **Step 4: Implement**

`src/lib/planner/types.ts`:
```ts
/** Injectable randomness so plans are reproducible under test. */
export type Rng = () => number;

export type PlannedRecipient = {
  label: string;
  amount: bigint;
  offsetMinutes: number;
};

export type PayoutPlan = {
  recipients: PlannedRecipient[];
  total: bigint;
};
```

`src/lib/planner/split.ts`:
```ts
import type { Rng } from "./types";

/**
 * Split `total` into `n` uneven, non-round amounts that sum to exactly `total`.
 *
 * Round figures are the strongest amount fingerprint a payout leaves, so every
 * part is nudged off a whole-token boundary. All arithmetic is bigint on the
 * token's smallest unit — the sum is exact, never approximate.
 */
export function splitAmounts(total: bigint, n: number, rng: Rng): bigint[] {
  if (n <= 0) throw new Error("splitAmounts: need at least one recipient");
  if (total < BigInt(n)) throw new Error("splitAmounts: total too small for that many recipients");

  // Integer weights keep the division exact; floats would lose precision at 1e18.
  const weights = Array.from({ length: n }, () => BigInt(Math.round((1 + rng()) * 1_000_000)));
  const weightSum = weights.reduce((a, b) => a + b, 0n);

  const parts = weights.map((w) => (total * w) / weightSum);
  // Whatever integer division dropped goes to the last part, so the sum is exact.
  const assigned = parts.reduce((a, b) => a + b, 0n);
  parts[n - 1] += total - assigned;

  return deround(parts, rng);
}

const ONE_TOKEN = 10n ** 18n;

/** Nudge whole-token amounts off their boundary, conserving the total. */
function deround(parts: bigint[], rng: Rng): bigint[] {
  const out = [...parts];
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] % ONE_TOKEN !== 0n) continue;
    const nudge = BigInt(Math.floor(rng() * 1e15)) + 1n;
    if (out[out.length - 1] - nudge <= 0n) continue;
    out[i] -= nudge;
    out[out.length - 1] += nudge;
  }
  // The last part is fixed up separately: it absorbs every nudge above.
  if (out[out.length - 1] % ONE_TOKEN === 0n && out.length > 1 && out[0] > ONE_TOKEN) {
    const nudge = BigInt(Math.floor(rng() * 1e15)) + 1n;
    out[out.length - 1] -= nudge;
    out[0] += nudge;
  }
  return out;
}
```

`src/lib/planner/schedule.ts`:
```ts
import type { Rng } from "./types";

/**
 * Suggested claim offsets, in minutes, spread unevenly across `windowMinutes`.
 *
 * Claims that land in a tight burst are correlatable even though each one is
 * individually private, so the gaps are deliberately irregular.
 */
export function scheduleClaims(n: number, windowMinutes: number, rng: Rng): number[] {
  if (n <= 0) throw new Error("scheduleClaims: need at least one recipient");
  if (windowMinutes < n) throw new Error("scheduleClaims: window too short for that many claims");

  const picks = new Set<number>();
  while (picks.size < n) {
    picks.add(1 + Math.floor(rng() * windowMinutes));
  }
  return [...picks].sort((a, b) => a - b);
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit and push**

```bash
git add src/lib/planner vitest.config.ts package.json package-lock.json
git commit -m "feat(planner): non-round amount splitting and irregular claim scheduling"
git push origin main
```

---

### Task 5: Escrow client — commitments and action batches

**Files:**
- Create: `src/lib/escrow/commitment.ts`
- Create: `src/lib/escrow/actions.ts`
- Create: `src/lib/escrow/commitment.test.ts`
- Create: `src/lib/escrow/actions.test.ts`
- Modify: `src/utils/constants.ts` (add the escrow address and pool address)

**Interfaces:**
- Consumes: nothing from earlier tasks except the tag value.
- Produces: `PAYROLL_TAG: string`; `commitmentHash(secret: string, amount: bigint): string`; `randomSecret(): string`; `buildFundActions(a: { token: string; total: bigint; escrow: string; batchId: string; commitments: string[] }): STRK20_ACTION[]`; `buildClaimActions(a: { token: string; escrow: string; claimer: string; secret: string; amount: bigint }): STRK20_ACTION[]`.

- [ ] **Step 1: Write the failing tests**

`src/lib/escrow/commitment.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { commitmentHash, randomSecret, PAYROLL_TAG } from "./commitment";

describe("commitmentHash", () => {
  it("uses the versioned short-string tag the Cairo contract uses", () => {
    expect(PAYROLL_TAG).toBe("0x53415f504159524f4c4c5f5631");
  });

  it("matches the vector printed by the Cairo test", () => {
    // Replace with the exact value printed by `snforge test print_parity_vector`
    // in Task 1 Step 5. This test is the TS/Cairo parity gate.
    expect(commitmentHash("0x2a", 100n)).toBe(CAIRO_PARITY_VECTOR);
  });

  it("binds both the secret and the amount", () => {
    const a = commitmentHash("0x2a", 100n);
    expect(commitmentHash("0x2b", 100n)).not.toBe(a);
    expect(commitmentHash("0x2a", 101n)).not.toBe(a);
    expect(commitmentHash("0x2a", 100n)).toBe(a);
  });

  it("generates distinct secrets", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => randomSecret()));
    expect(secrets.size).toBe(50);
  });
});
```

Note: define `const CAIRO_PARITY_VECTOR = "0x..."` at the top of the file using the value the Cairo test printed. Do not guess it — run Task 1's test and paste the output.

`src/lib/escrow/actions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildClaimActions, buildFundActions } from "./actions";

const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ESCROW = "0xabc";
const CLAIMER = "0xdef";

describe("buildFundActions", () => {
  it("withdraws to the escrow then invokes Fund with the commitment span", () => {
    const actions = buildFundActions({
      token: TOKEN,
      total: 30n,
      escrow: ESCROW,
      batchId: "0x7",
      commitments: ["0x11", "0x22"],
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "withdraw",
      token: TOKEN,
      amount: "0x1e",
      recipient: ESCROW,
    });
    // operation=Fund(0), batch_id, token, secret=0, amount=0, note_id=0, span(len,...items)
    expect(actions[1]).toEqual({
      type: "invoke",
      contract: ESCROW,
      calldata: ["0x0", "0x7", TOKEN, "0x0", "0x0", "0x0", "0x2", "0x11", "0x22"],
    });
  });
});

describe("buildClaimActions", () => {
  it("opens a note for the claimer then invokes Claim against it", () => {
    const actions = buildClaimActions({
      token: TOKEN,
      escrow: ESCROW,
      claimer: CLAIMER,
      secret: "0x2a",
      amount: 12n,
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: TOKEN,
      amount: "OPEN",
      recipient: CLAIMER,
    });
    // operation=Claim(1), batch_id=0, token=0, secret, amount, note placeholder, empty span
    expect(actions[1]).toEqual({
      type: "invoke",
      contract: ESCROW,
      calldata: ["0x1", "0x0", "0x0", "0x2a", "0xc", "${openNoteIds[0]}", "0x0"],
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — `./commitment` and `./actions` do not exist.

- [ ] **Step 3: Implement**

`src/lib/escrow/commitment.ts`:
```ts
import { hash, num, shortString } from "starknet";

/** Domain-separation tag. Must stay identical to PAYROLL_COMMITMENT_TAG in Cairo. */
export const PAYROLL_TAG = shortString.encodeShortString("SA_PAYROLL_V1");

/**
 * poseidon(TAG, secret, amount) — the same span the Cairo contract hashes.
 *
 * The amount lives inside the preimage, which is what keeps per-recipient
 * amounts out of the funding calldata.
 */
export function commitmentHash(secret: string, amount: bigint): string {
  return hash.computePoseidonHashOnElements([PAYROLL_TAG, secret, num.toHex(amount)]);
}

/** A 252-bit random secret, generated in the browser and never transmitted. */
export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return num.toHex(BigInt("0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")));
}
```

`src/lib/escrow/actions.ts`:
```ts
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";

/** Enum variant indices — must match `PayrollOperation` in Cairo. */
const OP_FUND = "0x0";
const OP_CLAIM = "0x1";
const ZERO = "0x0";

/**
 * Fund one batch: the pool withdraws `total` to the escrow, then calls its
 * privacy_invoke. Calldata order mirrors privacy_invoke's parameters exactly —
 * the pool deserializes straight into them.
 */
export function buildFundActions(a: {
  token: string;
  total: bigint;
  escrow: string;
  batchId: string;
  commitments: string[];
}): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "withdraw", token: a.token, amount: num.toHex(a.total), recipient: a.escrow },
    {
      type: "invoke",
      contract: a.escrow,
      calldata: [
        OP_FUND,
        a.batchId,
        a.token,
        ZERO, // secret — unused on Fund
        ZERO, // amount — unused on Fund
        ZERO, // note_id — unused on Fund
        num.toHex(a.commitments.length), // Span<felt252> length prefix
        ...a.commitments,
      ],
    },
  ];
}

/**
 * Claim one commitment into a fresh open note owned by the claimer.
 *
 * "OPEN" and "${openNoteIds[0]}" are literal placeholders the wallet
 * substitutes during assembly — they must not be hex-normalized.
 */
export function buildClaimActions(a: {
  token: string;
  escrow: string;
  claimer: string;
  secret: string;
  amount: bigint;
}): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "transfer", token: a.token, amount: "OPEN", recipient: a.claimer },
    {
      type: "invoke",
      contract: a.escrow,
      calldata: [
        OP_CLAIM,
        ZERO, // batch_id — resolved from the commitment
        ZERO, // token — resolved from the batch
        a.secret,
        num.toHex(a.amount),
        "${openNoteIds[0]}",
        ZERO, // empty Span<felt252>
      ],
    },
  ];
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS. If the parity test fails, the Cairo and TS hashes disagree — fix before going further; every claim depends on it.

- [ ] **Step 5: Add the addresses to constants**

In `src/utils/constants.ts`, append:
```ts
// STRK20 privacy pool (mainnet). Source of truth for the pool fee via get_fee_amount.
export const PRIVACY_POOL_MAINNET =
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

// PayrollEscrow (DRAFT, unaudited). Set after Task 8's deploy; "0x0" disables payroll.
export const PayrollEscrowAddress = process.env.NEXT_PUBLIC_PAYROLL_ESCROW ?? "0x0";
```
And add `NEXT_PUBLIC_PAYROLL_ESCROW=0x0` to `.env.example`.

- [ ] **Step 6: Commit and push**

```bash
git add src/lib/escrow src/utils/constants.ts .env.example
git commit -m "feat(escrow): commitment hashing with Cairo parity and STRK20 action builders"
git push origin main
```

---

### Task 6: Payroll UI — intent to signed plan

**Files:**
- Create: `src/app/components/client/Payroll/PayrollPanel.tsx`
- Create: `src/app/components/client/Payroll/PlanPreview.tsx`
- Create: `src/app/components/client/Payroll/ClaimLinks.tsx`
- Modify: `src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx:136-142` (add a `payroll` tab)

**Interfaces:**
- Consumes: `splitAmounts`, `scheduleClaims` (Task 4); `commitmentHash`, `randomSecret`, `buildFundActions` (Task 5); `PayrollEscrowAddress`, `PRIVACY_POOL_MAINNET` (Task 5).
- Produces: `<PayrollPanel />`, default-exported, self-contained; a `payroll` entry in the existing `TabKey` union.

- [ ] **Step 1: Build the plan preview**

`src/app/components/client/Payroll/PlanPreview.tsx` renders a `PayoutPlan` as a table of `label / amount / suggested claim offset`, plus a two-column "public vs hidden" panel stating verbatim:

- Public: the escrow's funded total, the pool→escrow transfer, every claim's amount, and all timing.
- Hidden: which recipient holds which commitment, per-recipient amounts until they claim, and the employer→recipient mapping.

It also renders a warning when `sum(amounts) > shielded balance − poolFee`, and a note that over-registering commitments only strands that employer's own batch.

- [ ] **Step 2: Build the panel**

`PayrollPanel.tsx` holds the form (recipient labels, total, claim window), calls `splitAmounts` + `scheduleClaims` on submit, generates one `randomSecret()` per recipient, derives `commitmentHash(secret, amount)` for each, and shows `<PlanPreview />` before anything is signed. `randomSecret()` output is kept in component state only — never logged, never sent anywhere.

- [ ] **Step 3: Wire the tab**

In `WalletAccountV6Tag.tsx`, extend the union and the tab list:
```tsx
type TabKey = "shield" | "send" | "unshield" | "echo" | "balances" | "payroll";
const TABS: { key: TabKey; label: string }[] = [
  { key: "shield", label: "Shield" },
  { key: "send", label: "Send" },
  { key: "unshield", label: "Unshield" },
  { key: "echo", label: "Echo" },
  { key: "balances", label: "Balances" },
  { key: "payroll", label: "Payroll" },
];
```
Render `<PayrollPanel />` when `tab === "payroll"`, gated on `isStrk20Network` exactly like the existing actions.

- [ ] **Step 4: Verify it builds and renders**

Run: `npm run build`
Expected: compiles, TypeScript clean.
Then `npm run dev`, open `http://localhost:3000`, select the Payroll tab, enter 3 recipients totalling 30 STRK, and confirm the preview shows three uneven non-round amounts, three different claim offsets, and the public/hidden panel.

- [ ] **Step 5: Commit and push**

```bash
git add src/app/components/client/Payroll src/app/components/client/WalletHandle/WalletAccountV6Tag.tsx
git commit -m "feat(ui): payroll intent form with plan preview and public/hidden disclosure"
git push origin main
```

---

### Task 7: Execute fund and claim through the wallet

**Files:**
- Modify: `src/app/components/client/Payroll/PayrollPanel.tsx`
- Create: `src/app/components/client/Payroll/ClaimPanel.tsx`
- Create: `src/lib/escrow/submit.ts`

**Interfaces:**
- Consumes: `buildFundActions`, `buildClaimActions` (Task 5); the existing `submit()` receipt helpers in `WalletAccountV6Tag.tsx`.
- Produces: `dryRun(account, actions): Promise<{ ok: true } | { ok: false; error: string }>` and `readPoolFee(provider): Promise<bigint>`.

- [ ] **Step 1: Write the shared submit helpers**

`src/lib/escrow/submit.ts`:
```ts
import type { ProviderInterface } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import { PRIVACY_POOL_MAINNET } from "@/utils/constants";

/**
 * Dry-run the batch without submitting. This is the cheapest way to catch a
 * calldata-shape mistake, and it runs before the user is asked to sign.
 */
export async function dryRun(
  account: { strk20PrepareInvoke: (a: WALLET_API.STRK20_ACTION[], b: boolean) => Promise<unknown> },
  actions: WALLET_API.STRK20_ACTION[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await account.strk20PrepareInvoke(actions, true);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The flat per-operation pool fee. Read live — it is governance-set, not a constant. */
export async function readPoolFee(provider: ProviderInterface): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: PRIVACY_POOL_MAINNET,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  const raw = Array.isArray(res) ? res[0] : (res as { result: string[] }).result[0];
  return BigInt(raw);
}
```

- [ ] **Step 2: Wire funding into the panel**

On "Fund payroll": call `readPoolFee`, show `total + fee` as the real cost, run `dryRun` and block on failure showing the raw error, then `submit(buildFundActions({...}), setResultFund, label)` reusing the existing receipt renderer. On success, render `<ClaimLinks />` with one link per recipient encoding `secret` and `amount` in the URL fragment (`#claim=<secret>.<amount>`) so the secret never reaches a server as a query parameter.

- [ ] **Step 3: Build the claim panel**

`ClaimPanel.tsx` reads `secret` and `amount` from `window.location.hash`, shows the amount about to be claimed, then on click runs `dryRun` and `submit(buildClaimActions({...}))`. It states that new notes mature about 10 blocks before they are spendable, so the wait is expected rather than a stall.

- [ ] **Step 4: Verify**

Run: `npm run build` — expect a clean TypeScript build.
Then `npm test` — expect all Task 4/5 tests still passing.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/escrow/submit.ts src/app/components/client/Payroll
git commit -m "feat(payroll): dry-run guarded fund and claim execution with live pool fee"
git push origin main
```

---

### Task 8: Audit the draft contract, then deploy and record

**Files:**
- Create: `cairo-payroll/AUDIT.md`
- Modify: `strk20.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: the full contract from Tasks 1–3.
- Produces: a deployed mainnet address recorded in `strk20.json` and `NEXT_PUBLIC_PAYROLL_ESCROW`.

- [ ] **Step 1: Run the audit skills over the contract**

Run the `feynman-auditor` and `state-inconsistency-auditor` skills against `cairo-payroll/src/lib.cairo`. The coupled state to interrogate specifically: `batches[id].remaining`, `accounted[token]`, and `commitments[h].claimed` must move together on every claim, and `accounted[token]` must always equal the sum of all live `batches[*].remaining` for that token.

Write the findings and their resolutions into `cairo-payroll/AUDIT.md`. Fix anything material before deploying. Do not skip this step — the contract holds real funds across transactions.

- [ ] **Step 2: Build the contract**

Run: `cd cairo-payroll && scarb build`
Expected: `target/dev/payroll_escrow_PayrollEscrow.contract_class.json` exists.

- [ ] **Step 3: Declare and deploy to mainnet**

```bash
export STARKNET_RPC="https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/$NEXT_PUBLIC_PROVIDER_URL"
starkli declare target/dev/payroll_escrow_PayrollEscrow.contract_class.json
starkli deploy <CLASS_HASH> 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```
The single constructor argument is the mainnet pool address, which pins the only caller allowed to drive `privacy_invoke`.

- [ ] **Step 4: Record the deployment**

Put the deployed address in `.env.local` as `NEXT_PUBLIC_PAYROLL_ESCROW`, and in `strk20.json` under `contracts`. Record the class hash in `cairo-payroll/address.md`.

- [ ] **Step 5: Run the three mainnet transactions and record them**

Shield, then Fund, then one Claim — each is one private operation costing 6 STRK. Put all three transaction hashes into `strk20.json` under `transactions`.

- [ ] **Step 6: Commit and push**

```bash
git add strk20.json cairo-payroll/AUDIT.md cairo-payroll/address.md README.md
git commit -m "chore: record PayrollEscrow mainnet deploy and sprint transactions"
git push origin main
```

---

## Self-Review

**Spec coverage:** route and trust boundary → Tasks 5–7 (no keys held, no viewing key asked); hidden-vs-visible → Task 6 Step 1; three-transaction flow → Tasks 7–8; contract surface and storage → Tasks 1–3; per-batch isolation → Task 2 Step 3 and Task 3's `INSUFFICIENT_BATCH` test; `accounted[]` balance delta → Task 2 Step 3 and the `NO_INPUT` test; planner → Task 4; error handling (dry-run, bounded wait, live fee, note maturity) → Task 7; testing → Tasks 1–5 plus Task 8 Step 1; sprint deliverables → Task 8.

**Type consistency:** `compute_commitment_hash(secret, amount)` keeps that argument order in Cairo (Task 1) and `commitmentHash(secret, amount)` in TS (Task 5). `PayrollOperation::Fund` is calldata `0x0` and `Claim` is `0x1` in both Task 2's contract and Task 5's builders. `Batch { token, remaining }` and `Commit { batch_id, claimed }` field names match across Tasks 1–3.

**Known gap, deliberate:** Task 5's parity test needs the literal hash printed by Task 1 Step 5. It is marked as a value to paste, not to guess, because inventing it would defeat the test's purpose.
