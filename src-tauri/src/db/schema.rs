// @generated automatically by Diesel CLI.

diesel::table! {
    assistant_emoji_packs (assistant_id, pack_id) {
        assistant_id -> Text,
        pack_id -> Text,
        created_at -> BigInt,
    }
}

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
        enabled_tools -> Nullable<Text>,
        thinking_enabled -> Integer,
        thinking_budget -> Nullable<Integer>,
        tool_preset_id -> Nullable<Text>,
        auto_compact_enabled -> Integer,
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
    cached_models (id) {
        id -> Nullable<Integer>,
        provider_id -> Text,
        model_id -> Text,
        model_name -> Text,
        fetched_at -> BigInt,
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
        compact_cursor -> Nullable<Integer>,
        thinking_level -> Nullable<Text>,
        fast_mode -> Integer,
        mode -> Nullable<Text>,
        head_message_id -> Nullable<Text>,
    }
}

diesel::table! {
    mode_artifacts (id) {
        id -> Text,
        conversation_id -> Text,
        kind -> Text,
        content -> Text,
        status -> Text,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    custom_tools (id) {
        id -> Text,
        name -> Text,
        description -> Text,
        category_id -> Nullable<Text>,
        parameters_schema -> Text,
        command -> Text,
        args_template -> Nullable<Text>,
        working_directory -> Nullable<Text>,
        timeout_ms -> Nullable<Integer>,
        permission -> Text,
        is_enabled -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    emoji_packs (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        cover_image -> Nullable<Text>,
        is_builtin -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    emojis (id) {
        id -> Text,
        pack_id -> Text,
        name -> Text,
        tags -> Nullable<Text>,
        file_name -> Text,
        file_format -> Text,
        sort_order -> Integer,
        created_at -> BigInt,
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
        headers -> Nullable<Text>,
    }
}

diesel::table! {
    memories (id) {
        id -> Text,
        scope_type -> Text,
        scope_id -> Text,
        key -> Text,
        content -> Text,
        memory_type -> Text,
        subject_scope_id -> Nullable<Text>,
        origin -> Text,
        visibility -> Text,
        source_session_id -> Nullable<Text>,
        deleted_at -> Nullable<BigInt>,
        deleted_by -> Nullable<Text>,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    memory_proposals (id) {
        id -> Integer,
        key -> Text,
        content -> Text,
        memory_type -> Text,
        origin_session -> Nullable<Text>,
        proposer_id -> Nullable<BigInt>,
        status -> Text,
        created_at -> BigInt,
        expires_at -> BigInt,
        resolved_at -> Nullable<BigInt>,
        resolved_by -> Nullable<BigInt>,
    }
}

diesel::table! {
    memory_subjects (scope_id) {
        scope_id -> Text,
        display_name -> Nullable<Text>,
        last_seen_at -> BigInt,
        created_at -> BigInt,
        is_protected -> Integer,
        is_pinned -> Integer,
        opted_out -> Integer,
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
        reasoning_content -> Nullable<Text>,
        rating -> Nullable<Integer>,
        schema_version -> Integer,
        is_compact_summary -> Integer,
        sender_id -> Nullable<BigInt>,
        parent_id -> Nullable<Text>,
        compact_anchor_id -> Nullable<Text>,
        source -> Nullable<Text>,
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
    projects (id) {
        id -> Text,
        name -> Text,
        path -> Nullable<Text>,
        source_type -> Text,
        source_id -> Nullable<Text>,
        assistant_id -> Nullable<Text>,
        description -> Nullable<Text>,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    prompt_templates (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        category -> Text,
        template_text -> Text,
        is_builtin -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    skills (dir_name) {
        dir_name -> Text,
        llm_name -> Text,
        llm_description -> Text,
        display_name -> Text,
        display_description -> Nullable<Text>,
        source -> Text,
        is_enabled -> Integer,
        is_builtin -> Integer,
        mtime_hash -> Nullable<Text>,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    skill_bindings_global (dir_name) {
        dir_name -> Text,
    }
}

diesel::table! {
    skill_bindings_project (project_id, dir_name) {
        project_id -> Text,
        dir_name -> Text,
    }
}

diesel::table! {
    skill_bindings_assistant (assistant_id, dir_name) {
        assistant_id -> Text,
        dir_name -> Text,
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
        api_format -> Text,
    }
}

diesel::table! {
    tool_categories (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        icon -> Nullable<Text>,
        sort_order -> Integer,
        created_at -> BigInt,
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

diesel::table! {
    tool_presets (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        icon -> Nullable<Text>,
        tool_names -> Text,
        is_builtin -> Integer,
        sort_order -> Integer,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    model_configs (id) {
        id -> Text,
        provider_id -> Text,
        model_id -> Text,
        display_name -> Nullable<Text>,
        context_window -> Integer,
        compact_threshold -> Integer,
        max_output_tokens -> Nullable<Integer>,
        input_price -> Double,
        output_price -> Double,
        cache_price -> Nullable<Double>,
        created_at -> BigInt,
        updated_at -> BigInt,
        capability_overrides -> Nullable<Text>,
    }
}

diesel::table! {
    todo_lists (id) {
        id -> Text,
        conversation_id -> Text,
        title -> Text,
        status -> Text,
        created_at -> BigInt,
        updated_at -> BigInt,
    }
}

diesel::table! {
    todo_items (id) {
        id -> Text,
        list_id -> Text,
        content -> Text,
        active_form -> Text,
        status -> Text,
        sort_order -> Integer,
        created_at -> BigInt,
    }
}

diesel::joinable!(assistant_emoji_packs -> assistants (assistant_id));
diesel::joinable!(assistant_emoji_packs -> emoji_packs (pack_id));
diesel::joinable!(assistants -> providers (provider_id));
diesel::joinable!(assistants -> tool_presets (tool_preset_id));
diesel::joinable!(attachments -> messages (message_id));
diesel::joinable!(cached_models -> providers (provider_id));
diesel::joinable!(model_configs -> providers (provider_id));
diesel::joinable!(conversations -> assistants (assistant_id));
diesel::joinable!(conversations -> projects (project_id));
diesel::joinable!(custom_tools -> tool_categories (category_id));
diesel::joinable!(emojis -> emoji_packs (pack_id));
diesel::joinable!(messages -> conversations (conversation_id));
diesel::joinable!(messages -> providers (provider_id));
diesel::joinable!(projects -> assistants (assistant_id));
diesel::joinable!(tool_permissions -> mcp_servers (mcp_server_id));
diesel::joinable!(skill_bindings_global -> skills (dir_name));
diesel::joinable!(skill_bindings_project -> projects (project_id));
diesel::joinable!(skill_bindings_project -> skills (dir_name));
diesel::joinable!(skill_bindings_assistant -> assistants (assistant_id));
diesel::joinable!(skill_bindings_assistant -> skills (dir_name));
diesel::joinable!(mode_artifacts -> conversations (conversation_id));
diesel::joinable!(todo_lists -> conversations (conversation_id));
diesel::joinable!(todo_items -> todo_lists (list_id));

diesel::allow_tables_to_appear_in_same_query!(
    assistant_emoji_packs,assistants,attachments,cached_models,conversations,custom_tools,emoji_packs,emojis,mcp_servers,memories,memory_proposals,memory_subjects,messages,mode_artifacts,model_configs,preferences,projects,prompt_templates,providers,skill_bindings_assistant,skill_bindings_global,skill_bindings_project,skills,todo_items,todo_lists,tool_categories,tool_permissions,tool_presets,);
