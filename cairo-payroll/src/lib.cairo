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
    core::poseidon::poseidon_hash_span([PAYROLL_COMMITMENT_TAG, secret, amount.into()].span())
}
