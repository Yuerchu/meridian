import { useState } from 'react'
import {
  AttachmentList,
  AttachmentPreview,
} from '@/components/yuerchu-ui/components/attachment-preview/attachment-preview'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { HoverCard } from '@/components/yuerchu-ui/components/hover-card/hover-card'
import { ImageViewer } from '@/components/yuerchu-ui/components/image-viewer/image-viewer'
import { FileDiffCard } from '@/components/chat/file-diff-card'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { ShikiCode } from '@/components/chat/shiki-code'
import { parsePatchText } from '@/lib/patch-parse'
import { PLAN_MD, UNIFIED_PATCH } from './fixtures'
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
  '2. 第二项，带 [链接](https://yuerchu.com)',
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

const SAMPLE_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#8fb4ff"/></svg>',
)}`

function AttachmentsAndViewer() {
  const [viewerOpen, setViewerOpen] = useState(false)
  return (
    <Stage>
      <AttachmentList aria-label="附件预览">
        <AttachmentPreview name="design-notes.md" size={4096} />
        <AttachmentPreview name="report-final.pdf" size={248_000} />
        <AttachmentPreview name="截图.svg" imageUrl={SAMPLE_IMAGE} />
      </AttachmentList>
      <div>
        <Button variant="secondary" size="sm" onPress={() => setViewerOpen(true)}>
          查看图片
        </Button>
        <ImageViewer
          isOpen={viewerOpen}
          onOpenChange={setViewerOpen}
          images={[{ id: 'sample', src: SAMPLE_IMAGE, alt: '示例截图' }]}
        />
      </div>
      <div>
        <HoverCard content={<div>引用来源摘要：Yuerchu UI 文档</div>}>
          <a href="https://yuerchu.com" target="_blank" rel="noreferrer">
            悬停查看引用卡片
          </a>
        </HoverCard>
      </div>
    </Stage>
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
      <Section title="AttachmentPreview · ImageViewer · HoverCard（库）">
        <AttachmentsAndViewer />
      </Section>
    </>
  )
}
