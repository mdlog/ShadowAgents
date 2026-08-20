//! The riskiest interface in the whole design: the pool deserialises raw calldata
//! straight into `privacy_invoke`'s parameters, positionally. One field out of
//! order and funds move against the wrong slot, with nothing to catch it.
//!
//! These tests dispatch the EXACT felt layout the TypeScript builders emit
//! (`src/lib/escrow/actions.ts`, pinned literally in `actions.test.ts`) through a
//! raw `call_contract_syscall`, and assert both that it deserialises and that the
//! returned span matches what the pool expects to apply.
//!
//! Layout, and it must stay identical on both sides:
//!   Fund  = [0, batch_id, token, 0, 0, 0, commitments_len, ...commitments]
//!   Claim = [1, 0, 0, secret, amount, note_id, 0]

use payroll_escrow::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use payroll_escrow::compute_commitment_hash;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address};
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResultTrait};

fn POOL() -> ContractAddress {
    0x1234.try_into().unwrap()
}

fn setup(amount: u256) -> (ContractAddress, ContractAddress) {
    let erc20 = declare("MockErc20").unwrap().contract_class();
    let (token, _) = erc20.deploy(@array![]).unwrap();
    let escrow_class = declare("PayrollEscrow").unwrap().contract_class();
    let (escrow, _) = escrow_class.deploy(@array![POOL().into()]).unwrap();
    IMockErc20Dispatcher { contract_address: token }.mint(escrow, amount);
    start_cheat_caller_address(escrow, POOL());
    (escrow, token)
}

/// Fund calldata deserialises, and returns an empty span (nothing to credit yet).
#[test]
fn fund_calldata_from_the_dapp_deserialises() {
    let (escrow, token) = setup(30);

    // Exactly what buildFundActions() puts in the invoke action.
    let calldata = array![
        0, // operation = Fund
        'b1', // batch_id
        token.into(), // token
        0, // secret   (unused on Fund)
        0, // amount   (unused on Fund)
        0, // note_id  (unused on Fund)
        2, // Span<felt252> length prefix
        'h1',
        'h2',
    ];

    let ret = call_contract_syscall(escrow, selector!("privacy_invoke"), calldata.span())
        .unwrap_syscall();

    // Span<OpenNoteDeposit> with no entries serialises to a single 0 length felt.
    assert(ret.len() == 1, 'ret len wrong');
    assert(*ret.at(0) == 0, 'fund should credit nothing');
}

/// Claim calldata deserialises, and returns exactly one OpenNoteDeposit in the
/// field order the pool reads: note_id, token, amount.
#[test]
fn claim_calldata_from_the_dapp_returns_one_open_note_deposit() {
    let (escrow, token) = setup(30);

    let h = compute_commitment_hash('sec', 12);
    let fund_calldata = array![0, 'b1', token.into(), 0, 0, 0, 1, h];
    call_contract_syscall(escrow, selector!("privacy_invoke"), fund_calldata.span())
        .unwrap_syscall();

    // Exactly what buildClaimActions() puts in the invoke action, with the wallet's
    // ${openNoteIds[0]} placeholder already substituted for a real note id.
    let calldata = array![
        1, // operation = Claim
        0, // batch_id  (resolved from the commitment)
        0, // token     (resolved from the batch)
        'sec', // secret
        12, // amount
        'note1', // note_id
        0 // empty Span<felt252>
    ];

    let ret = call_contract_syscall(escrow, selector!("privacy_invoke"), calldata.span())
        .unwrap_syscall();

    // [len=1, note_id, token, amount] — three felts per OpenNoteDeposit.
    assert(ret.len() == 4, 'ret len wrong');
    assert(*ret.at(0) == 1, 'expected one deposit');
    assert(*ret.at(1) == 'note1', 'note_id wrong');
    assert(*ret.at(2) == token.into(), 'token wrong');
    assert(*ret.at(3) == 12, 'amount wrong');
}

// Malformed calldata — a missing Span length prefix, or a length that overstates
// the array — is rejected by the entry-point deserialiser before any contract logic
// runs, with `Failed to deserialize param #N`. Verified by running both cases
// manually; they are not kept as tests because snforge surfaces that failure as a
// harness-level hint error that neither `should_panic` nor a `SyscallResult` can
// catch, so a test asserting it would always report red.
