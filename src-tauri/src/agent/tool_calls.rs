use crate::provider;

pub(crate) fn extract_tool_calls_from_blocks(blocks_json: &str) -> Vec<provider::ToolCall> {
    let blocks: Vec<serde_json::Value> = match serde_json::from_str(blocks_json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    blocks
        .iter()
        .filter_map(|b| {
            if b.get("type")?.as_str()? != "tool_call" {
                return None;
            }
            let data = b.get("data")?;
            Some(provider::ToolCall {
                id: data.get("call_id")?.as_str()?.to_string(),
                name: data.get("tool_name")?.as_str()?.to_string(),
                arguments: data.get("arguments")?.as_str()?.to_string(),
            })
        })
        .collect()
}

pub(crate) fn parse_openai_tool_calls(json: Option<&str>) -> Vec<provider::ToolCall> {
    let Some(json) = json else { return vec![] };
    let arr: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    arr.iter()
        .filter_map(|tc| {
            let func = tc.get("function")?;
            Some(provider::ToolCall {
                id: tc.get("id")?.as_str()?.to_string(),
                name: func.get("name")?.as_str()?.to_string(),
                arguments: func.get("arguments")?.as_str()?.to_string(),
            })
        })
        .collect()
}

pub(crate) fn serialize_tool_calls_openai(tool_calls: &[provider::ToolCall]) -> String {
    serde_json::to_string(
        &tool_calls
            .iter()
            .map(|tc| {
                serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": { "name": tc.name, "arguments": tc.arguments }
                })
            })
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default()
}
