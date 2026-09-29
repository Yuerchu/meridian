//! A model with the scorer's exact inputs and output, written out as ONNX
//! protobuf by hand so the tests need neither a checked-in binary nor a
//! Python toolchain.
//!
//! `logp = Cast<float>(text_ids) / -100`. The other three inputs are declared
//! and unused: the point is the contract — names, types, shapes — not what
//! the numbers mean.

fn varint(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let byte = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn key(out: &mut Vec<u8>, field: u32, wire: u8) {
    varint(out, (u64::from(field) << 3) | u64::from(wire));
}

fn int(out: &mut Vec<u8>, field: u32, v: u64) {
    key(out, field, 0);
    varint(out, v);
}

fn bytes(out: &mut Vec<u8>, field: u32, b: &[u8]) {
    key(out, field, 2);
    varint(out, b.len() as u64);
    out.extend_from_slice(b);
}

fn string(out: &mut Vec<u8>, field: u32, s: &str) {
    bytes(out, field, s.as_bytes());
}

const INT64: u64 = 7;
const FLOAT: u64 = 1;

/// ValueInfoProto for a rank-2 tensor with symbolic dimensions.
fn value_info(name: &str, elem: u64, dims: [&str; 2]) -> Vec<u8> {
    let mut shape = Vec::new();
    for d in dims {
        let mut dim = Vec::new();
        string(&mut dim, 2, d); // dim_param
        bytes(&mut shape, 1, &dim);
    }
    let mut tensor = Vec::new();
    int(&mut tensor, 1, elem); // elem_type
    bytes(&mut tensor, 2, &shape);
    let mut ty = Vec::new();
    bytes(&mut ty, 1, &tensor); // tensor_type
    let mut vi = Vec::new();
    string(&mut vi, 1, name);
    bytes(&mut vi, 2, &ty);
    vi
}

fn node(inputs: &[&str], output: &str, op: &str, attrs: &[Vec<u8>]) -> Vec<u8> {
    let mut n = Vec::new();
    for i in inputs {
        string(&mut n, 1, i);
    }
    string(&mut n, 2, output);
    string(&mut n, 3, output);
    string(&mut n, 4, op);
    for a in attrs {
        bytes(&mut n, 5, a);
    }
    n
}

pub fn constant_model() -> Vec<u8> {
    let mut to = Vec::new();
    string(&mut to, 1, "to");
    int(&mut to, 3, FLOAT); // i
    int(&mut to, 20, 2); // type = INT

    let mut divisor = Vec::new();
    int(&mut divisor, 2, FLOAT); // data_type, scalar: no dims
    bytes(&mut divisor, 4, &(-100.0f32).to_le_bytes()); // float_data, packed
    string(&mut divisor, 8, "divisor");

    let mut graph = Vec::new();
    bytes(&mut graph, 1, &node(&["text_ids"], "text_f", "Cast", &[to]));
    bytes(&mut graph, 1, &node(&["text_f", "divisor"], "logp", "Div", &[]));
    string(&mut graph, 2, "meridian-ime-lm-fixture");
    bytes(&mut graph, 5, &divisor);
    bytes(&mut graph, 11, &value_info("ctx_ids", INT64, ["B", "Lc"]));
    bytes(&mut graph, 11, &value_info("ctx_mask", INT64, ["B", "Lc"]));
    bytes(&mut graph, 11, &value_info("text_ids", INT64, ["B", "Lt"]));
    bytes(&mut graph, 11, &value_info("text_mask", INT64, ["B", "Lt"]));
    bytes(&mut graph, 12, &value_info("logp", FLOAT, ["B", "Lt"]));

    let mut opset = Vec::new();
    string(&mut opset, 1, "");
    int(&mut opset, 2, 17);

    let mut model = Vec::new();
    int(&mut model, 1, 8); // ir_version
    string(&mut model, 2, "meridian-ime-lm tests"); // producer_name
    bytes(&mut model, 7, &graph);
    bytes(&mut model, 8, &opset);
    model
}

#[cfg(test)]
mod tests {
    #[test]
    fn varints_encode_as_protobuf_does() {
        let mut out = Vec::new();
        super::varint(&mut out, 300);
        assert_eq!(out, vec![0xac, 0x02]);
        assert!(!super::constant_model().is_empty());
    }
}
