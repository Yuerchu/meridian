import { Bold, Code, Italic, List, Strikethrough } from '@keyline-icons/react/two-tone'
import type { ComponentType } from 'react'

import {
  ChatAttachment,
  ChatAttachmentGroup,
  ChatSource,
  ChatSources,
  PromptSuggestion,
  RichTextEditor,
  type RichTextEditorFormatCommand,
} from '@/components/base'
import { FileDiffCard } from '@/components/chat/file-diff-card'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { ShikiCode } from '@/components/chat/shiki-code'
import { parsePatchText } from '@/lib/patch-parse'
import { noop, PLAN_MD, UNIFIED_PATCH } from './fixtures'
import { Section, Stage } from './shell'

const MARKDOWN = [
  PLAN_MD,
  '',
  '| 工具 | 免批 | 说明 |',
  '| --- | --- | --- |',
  '| `read_file` | 是 | 只读 |',
  '| `write_file` | 否 | 项目内可回滚 |',
  '',
  '> 引用：在计划里写清楚验证方法。',
  '',
  '1. 有序列表',
  '2. 第二项，带 [链接](https://boardui.com)',
].join('\n')

const RUST = [
  'pub fn verify(raw: &str) -> Result<Claims, AuthError> {',
  '    let claims = decode(raw)?;',
  '    if claims.exp < now() {',
  '        return Err(AuthError::Expired);',
  '    }',
  '    Ok(claims)',
  '}',
].join('\n')

const FORMATS: [RichTextEditorFormatCommand, string, ComponentType<{ className?: string }>][] = [
  ['bold', '粗体', Bold],
  ['italic', '斜体', Italic],
  ['strike', '删除线', Strikethrough],
  ['code', '行内代码', Code],
  ['bulletList', '列表', List],
]

function Editor() {
  return (
    <RichTextEditor placeholder="写点什么…" className="min-h-48">
      <RichTextEditor.Shell className="flex flex-col">
        <RichTextEditor.Toolbar aria-label="格式">
          <RichTextEditor.ToolbarGroup>
            {FORMATS.map(([command, label, icon]) => (
              <RichTextEditor.ToggleButton
                key={command}
                command={command}
                aria-label={label}
                tooltip={label}
                leadingIcon={icon}
              />
            ))}
          </RichTextEditor.ToolbarGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content />
      </RichTextEditor.Shell>
    </RichTextEditor>
  )
}

export default function Content() {
  const diffs = parsePatchText(UNIFIED_PATCH)
  return (
    <>
      <Section title="MarkdownContent">
        <Stage>
          <MarkdownContent content={MARKDOWN} />
        </Stage>
      </Section>
      <Section title="ShikiCode">
        <Stage>
          <ShikiCode code={RUST} language="rust" />
        </Stage>
      </Section>
      <Section title="FileDiffCard">
        {diffs.map((diff) => (
          <FileDiffCard key={diff.path} diff={diff} />
        ))}
      </Section>
      <Section title="RichTextEditor">
        <Stage>
          <Editor />
        </Stage>
      </Section>
      <Section title="ChatAttachment / ChatSource">
        <Stage>
          <ChatAttachmentGroup>
            <ChatAttachment name="design-notes.md" />
            <ChatAttachment name="report-final.pdf" />
            <ChatAttachment
              mediaType="image"
              name="截图"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#8fb4ff"/></svg>',
              )}`}
            />
          </ChatAttachmentGroup>
          <ChatSources defaultExpanded>
            <ChatSources.Trigger>2 个来源</ChatSources.Trigger>
            <ChatSources.Content>
              <ChatSources.List>
                {[
                  ['boardui', 'https://boardui.com', 'BoardUI'],
                  ['Base UI', 'https://base-ui.com/react/components/collapsible', 'Base UI Collapsible'],
                ].map(([site, href, title]) => (
                  <ChatSource key={href} href={href} title={site} description={title}>
                    <ChatSource.Trigger
                      href="#meridian-external"
                      rel="noreferrer noopener"
                      onClick={(e) => e.preventDefault()}
                    >
                      <ChatSource.Icon />
                      <ChatSource.Title>{site}</ChatSource.Title>
                    </ChatSource.Trigger>
                  </ChatSource>
                ))}
              </ChatSources.List>
            </ChatSources.Content>
          </ChatSources>
        </Stage>
      </Section>
      <Section title="PromptSuggestion">
        <PromptSuggestion>
          <PromptSuggestion.Items>
            {['帮我写一封邮件', '解释这段代码', '总结这篇文章'].map((text) => (
              <PromptSuggestion.Item key={text} onPress={noop}>
                {text}
              </PromptSuggestion.Item>
            ))}
          </PromptSuggestion.Items>
        </PromptSuggestion>
      </Section>
    </>
  )
}
