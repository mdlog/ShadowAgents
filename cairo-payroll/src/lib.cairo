//! PayrollEscrow — DRAFT anonymizer for the STRK20 privacy pool.
//!
//! NOT AUDITED. This adapts an unofficial escrow illustration, not a shipped
//! StarkWare package. It must pass review and audit before any mainnet deploy.


pub mod mock_erc20;
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
    pub const ZERO_POOL: felt252 = 'ZERO_POOL';
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
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
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
        /// Per-token total already promised to live batches — the baseline the balance
        /// delta is measured against, because this helper holds funds across
        /// transactions and so has no "before" snapshot to read.
        accounted: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Funded: Funded,
        Claimed: Claimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Funded {
        #[key]
        pub batch_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub batch_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_contract: ContractAddress) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_POOL);
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

                    let count = commitments.len();
                    let mut i: u32 = 0;
                    while i != count {
                        let h = *commitments.at(i);
                        assert(h.is_non_zero(), errors::ZERO_COMMITMENT);
                        assert(
                            self.commitments.read(h).batch_id.is_zero(), errors::COMMITMENT_EXISTS,
                        );
                        self.commitments.write(h, Commit { batch_id, claimed: false });
                        i += 1;
                    }

                    self.emit(Funded { batch_id, token, amount: funded, count });
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
