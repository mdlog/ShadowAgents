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

// Prints the vector the TypeScript parity test asserts against.
#[test]
fn print_parity_vector() {
    println!("PARITY secret=42 amount=100 -> {}", compute_commitment_hash(42, 100));
}
