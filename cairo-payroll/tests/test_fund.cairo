use payroll_escrow::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use payroll_escrow::{
    Batch, Commit, IPayrollEscrowDispatcher, IPayrollEscrowDispatcherTrait, PayrollOperation,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address};
use starknet::ContractAddress;

fn POOL() -> ContractAddress {
    0x1234.try_into().unwrap()
}

/// Deploys a mintable ERC-20 mock and the escrow, then funds the escrow with `amount`,
/// mirroring the pool transferring tokens in before it calls privacy_invoke.
fn setup(amount: u256) -> (IPayrollEscrowDispatcher, ContractAddress) {
    let erc20 = declare("MockErc20").unwrap().contract_class();
    let (token, _) = erc20.deploy(@array![]).unwrap();

    let escrow_class = declare("PayrollEscrow").unwrap().contract_class();
    let (escrow_addr, _) = escrow_class.deploy(@array![POOL().into()]).unwrap();

    IMockErc20Dispatcher { contract_address: token }.mint(escrow_addr, amount);

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
    // Second batch with no fresh transfer: balance == accounted, nothing to fund.
    escrow.privacy_invoke(PayrollOperation::Fund, 'b2', token, 0, 0, 0, array!['h2'].span());
}
