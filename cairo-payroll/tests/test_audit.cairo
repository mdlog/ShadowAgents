//! Audit probes: these pin down behaviour at the boundary between the escrow's
//! own accounting and the ERC-20 balance it does not control.

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

fn ZERO_ADDR() -> ContractAddress {
    0.try_into().unwrap()
}

fn deploy() -> (IPayrollEscrowDispatcher, ContractAddress) {
    let erc20 = declare("MockErc20").unwrap().contract_class();
    let (token, _) = erc20.deploy(@array![]).unwrap();
    let escrow_class = declare("PayrollEscrow").unwrap().contract_class();
    let (addr, _) = escrow_class.deploy(@array![POOL().into()]).unwrap();
    start_cheat_caller_address(addr, POOL());
    (IPayrollEscrowDispatcher { contract_address: addr }, token)
}

/// An unsolicited transfer to the escrow raises balance_of without raising
/// `accounted`, so the next Fund measures it as part of its own delta and
/// absorbs it. Nobody can stop an ERC-20 transfer, so this is reachable.
#[test]
fn a_donation_is_absorbed_by_the_next_batch() {
    let (escrow, token) = deploy();
    let minter = IMockErc20Dispatcher { contract_address: token };

    // Someone sends 5 to the escrow before any batch exists.
    minter.mint(escrow.contract_address, 5);
    // The pool then withdraws 30 for a real batch.
    minter.mint(escrow.contract_address, 30);

    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h1'].span());

    // The batch is credited 35, not the 30 the pool actually withdrew.
    assert(escrow.get_batch('b1').remaining == 35, 'donation not absorbed');
    assert(escrow.get_accounted(token) == 35, 'accounted tracks it');
}

/// The donation is absorbed, but it cannot reach into an existing batch: a
/// funded batch's `remaining` is untouched by any later Fund.
#[test]
fn an_existing_batch_is_untouched_by_a_later_fund() {
    let (escrow, token) = deploy();
    let minter = IMockErc20Dispatcher { contract_address: token };

    minter.mint(escrow.contract_address, 30);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array!['h1'].span());

    minter.mint(escrow.contract_address, 50);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b2', token, 0, 0, 0, array!['h2'].span());

    assert(escrow.get_batch('b1').remaining == 30, 'b1 changed');
    assert(escrow.get_batch('b2').remaining == 50, 'b2 wrong');
    assert(escrow.get_accounted(token) == 80, 'accounted wrong');
}

/// A claim can only ever draw down its own batch, never another one.
#[test]
fn a_claim_draws_down_only_its_own_batch() {
    let (escrow, token) = deploy();
    let minter = IMockErc20Dispatcher { contract_address: token };

    minter.mint(escrow.contract_address, 30);
    let h1 = compute_commitment_hash('s1', 12);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array![h1].span());

    minter.mint(escrow.contract_address, 50);
    let h2 = compute_commitment_hash('s2', 40);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b2', token, 0, 0, 0, array![h2].span());

    escrow.privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 's1', 12, 'n1', array![].span());

    assert(escrow.get_batch('b1').remaining == 18, 'b1 wrong');
    assert(escrow.get_batch('b2').remaining == 50, 'b2 touched');
    assert(escrow.get_accounted(token) == 68, 'accounted wrong');
}

/// Value beyond what the registered commitments can claim stays in the contract
/// forever: there is no sweep, by design, because a sweep would need an owner.
#[test]
fn surplus_beyond_the_registered_commitments_is_stranded() {
    let (escrow, token) = deploy();
    let minter = IMockErc20Dispatcher { contract_address: token };

    minter.mint(escrow.contract_address, 30);
    // Only one commitment worth 12 is registered against a 30-token batch.
    let h = compute_commitment_hash('s1', 12);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array![h].span());
    escrow.privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 's1', 12, 'n1', array![].span());

    // 18 remain promised to the batch, but no commitment can ever claim them.
    assert(escrow.get_batch('b1').remaining == 18, 'remaining wrong');
    assert(escrow.get_accounted(token) == 18, 'accounted wrong');
}

/// `accounted` is the baseline the delta is measured against, so it must never
/// drift above the balance actually held.
#[test]
fn accounted_never_exceeds_the_held_balance() {
    let (escrow, token) = deploy();
    let minter = IMockErc20Dispatcher { contract_address: token };

    minter.mint(escrow.contract_address, 30);
    let h = compute_commitment_hash('s1', 12);
    escrow.privacy_invoke(PayrollOperation::Fund, 'b1', token, 0, 0, 0, array![h].span());
    escrow.privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 's1', 12, 'n1', array![].span());

    // The pool has been approved for 12 but has not pulled yet in this test, so
    // the balance is still 30 while only 18 is accounted for.
    let held = IMockErc20Dispatcher { contract_address: token }
        .balance_of(escrow.contract_address);
    assert(held >= escrow.get_accounted(token).into(), 'accounted exceeds balance');
}
