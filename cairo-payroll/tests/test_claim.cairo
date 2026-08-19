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

/// Escrow funded with `total`, carrying one commitment for (secret, amount).
fn funded(
    total: u256, secret: felt252, amount: u128,
) -> (IPayrollEscrowDispatcher, ContractAddress) {
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

    let out = escrow
        .privacy_invoke(
            PayrollOperation::Claim, 0, ZERO_ADDR(), 'sec', 12, 'note1', array![].span(),
        );

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
    escrow
        .privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 'sec', 12, 'n1', array![].span());
    escrow
        .privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 'sec', 12, 'n2', array![].span());
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn a_wrong_secret_finds_nothing() {
    let (escrow, _) = funded(30, 'sec', 12);
    escrow
        .privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 'nope', 12, 'n1', array![].span());
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn the_right_secret_with_a_wrong_amount_finds_nothing() {
    let (escrow, _) = funded(30, 'sec', 12);
    escrow
        .privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 'sec', 13, 'n1', array![].span());
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BATCH')]
fn a_claim_cannot_exceed_what_its_batch_holds() {
    // Funded with 10 but the commitment promises 12 — employer over-registration.
    let (escrow, _) = funded(10, 'sec', 12);
    escrow
        .privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 'sec', 12, 'n1', array![].span());
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn claim_rejects_a_caller_that_is_not_the_pool() {
    let (escrow, _) = funded(30, 'sec', 12);
    start_cheat_caller_address(escrow.contract_address, 0xdead.try_into().unwrap());
    escrow
        .privacy_invoke(PayrollOperation::Claim, 0, ZERO_ADDR(), 'sec', 12, 'n1', array![].span());
}
