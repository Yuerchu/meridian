// @generated automatically by Diesel CLI.

diesel::table! {
    assistants (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        avatar -> Nullable<Text>,
        system_prompt -> Text,
        provider_id -> Nullable<Text>,
        model_id -> Nullable<Text>,
        temperature -> Nullable<Float>,
        top_p -> Nullable<Float>,
        max_tokens -> Nullable<Integer>,
        is_default -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
        context_limit -> Integer,
        compact_keep_recent -> Integer,
    }
}

diesel::table! {
    attachments (id) {
        id -> Text,
        message_id -> Text,
        file_name -> Text,
        file_path -> Text,
        mime_type -> Text,
        file_size -> BigInt,
        created_at -> BigInt,
    }
}

diesel::table! {
    conversations (id) {
        id -> Text,
        title -> Nullable<Text>,
        assistant_id -> Nullable<Text>,
        is_pinned -> Integer,
        is_archived -> Integer,
        message_count -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
        project_id -> Nullable<Text>,
    }
}

diesel::table! {
    projects (id) {
        id -> Text,
        name -> Text,
        path -> Text,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    mcp_servers (id) {
        id -> Text,
        name -> Text,
        transport_type -> Text,
        command -> Nullable<Text>,
        args -> Nullable<Text>,
        env -> Nullable<Text>,
        url -> Nullable<Text>,
        is_enabled -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    messages (id) {
        id -> Text,
        conversation_id -> Text,
        role -> Text,
        content -> Text,
        provider_id -> Nullable<Text>,
        model_id -> Nullable<Text>,
        input_tokens -> Nullable<Integer>,
        output_tokens -> Nullable<Integer>,
        tool_calls -> Nullable<Text>,
        tool_call_id -> Nullable<Text>,
        sort_order -> Integer,
        created_at -> BigInt,
    }
}

diesel::table! {
    preferences (key) {
        key -> Text,
        value -> Text,
        updated_at -> BigInt,
    }
}

diesel::table! {
    providers (id) {
        id -> Text,
        name -> Text,
        provider_type -> Text,
        base_url -> Text,
        is_enabled -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    tool_permissions (id) {
        id -> Text,
        tool_name -> Text,
        mcp_server_id -> Nullable<Text>,
        permission -> Text,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::joinable!(assistants -> providers (provider_id));
diesel::joinable!(attachments -> messages (message_id));
diesel::joinable!(conversations -> assistants (assistant_id));
diesel::joinable!(conversations -> projects (project_id));
diesel::joinable!(messages -> conversations (conversation_id));
diesel::joinable!(messages -> providers (provider_id));
diesel::joinable!(tool_permissions -> mcp_servers (mcp_server_id));

diesel::allow_tables_to_appear_in_same_query!(
    assistants,
    attachments,
    conversations,
    mcp_servers,
    messages,
    preferences,
    projects,
    providers,
    tool_permissions,
);
