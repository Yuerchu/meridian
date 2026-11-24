import { Separator } from '@/components/yuerchu-ui/components/separator/separator'
import { useState } from 'react'
import { Bin, Plus, Sparkles } from '@keyline-icons/react/two-tone'

import { Avatar } from '@/components/yuerchu-ui/components/avatar/avatar'
import { Kbd } from '@/components/yuerchu-ui/components/kbd/kbd'
import { Link } from '@/components/yuerchu-ui/components/link/link'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { MenuItem, MenuSeparator } from '@/components/yuerchu-ui/components/menu/menu'
import { SplitButton } from '@/components/yuerchu-ui/components/split-button/split-button'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TagGroup, Tag } from '@/components/yuerchu-ui/components/tag-group/tag-group'
import { MeridianMark } from '@/components/ui/meridian-mark'
import { noop } from './fixtures'
import { Row, Section, Stage } from './shell'
import { CoreParts } from './parts'

const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const
const SIZES = ['lg', 'md', 'sm'] as const
const BADGE_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const

function Buttons() {
  return (
    <Stage>
      {SIZES.map((size) => (
        <Row key={size} label={size}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size} icon={variant === 'destructive' ? <Bin /> : <Plus />}>
              {variant}
            </Button>
          ))}
          <Button size={size} variant="ghost" icon={<Sparkles />} aria-label="仅图标" />
        </Row>
      ))}
      <Row label="状态">
        <Button isPending>保存中</Button>
        <Button isDisabled>不可用</Button>
        <Button variant="secondary" isDisabled>
          不可用
        </Button>
        <Button variant="destructive" isDisabled>
          不可用
        </Button>
      </Row>
      <Row label="SplitButton">
        <SplitButton
          size="sm"
          icon={<Plus />}
          onPress={noop}
          menuLabel="更多发布方式"
          menu={
            <>
              <MenuItem id="notify" icon={<Sparkles />} onAction={noop}>
                发布并通知
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon={<Bin />} tone="danger" onAction={noop}>
                删除草稿
              </MenuItem>
            </>
          }
        >
          发布
        </SplitButton>
        <SplitButton
          variant="secondary"
          size="md"
          icon={<Plus />}
          onPress={noop}
          menuLabel="更多保存方式"
          menu={
            <>
              <MenuItem id="copy" onAction={noop}>
                另存为副本
              </MenuItem>
            </>
          }
        >
          保存
        </SplitButton>
      </Row>
    </Stage>
  )
}

function Chips() {
  const [tags, setTags] = useState(['项目讨论', '实现方案', '测试结果'])
  return (
    <Stage>
      {(['sm', 'md'] as const).map((size) => (
        <Row key={size} label={size}>
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} size={size} tone={tone}>
              {tone}
            </Badge>
          ))}
        </Row>
      ))}
      <Row label="状态圆点">
        <Badge tone="success" hasDot>
          运行中
        </Badge>
      </Row>
      <Row label="可移除标签">
        <TagGroup
          aria-label="引用的会话"
          onRemove={(keys) => setTags((current) => current.filter((tag) => !keys.has(tag)))}
          renderEmptyState={() => '没有引用的会话'}
        >
          {tags.map((tag) => (
            <Tag key={tag} id={tag}>
              {tag}
            </Tag>
          ))}
        </TagGroup>
        <Button variant="secondary" onPress={() => setTags(['项目讨论', '实现方案', '测试结果'])}>
          重置
        </Button>
      </Row>
      <Row label="Kbd">
        <Kbd keys={['Ctrl', 'K']} />
        <Kbd keys={['⇧', '↵']} />
        <Kbd>Esc</Kbd>
      </Row>
      <Row label="Link">
        <Link onPress={noop}>正文链接</Link>
        <Link variant="standalone" onPress={noop}>
          独立链接
        </Link>
      </Row>
    </Stage>
  )
}

function Avatars() {
  return (
    <Stage>
      <Row label="circle">
        {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <Avatar key={size} size={size} name="于小丘" />
        ))}
      </Row>
      <Row label="square">
        {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <Avatar key={size} size={size} shape="square" name="Meridian" />
        ))}
      </Row>
    </Stage>
  )
}

function Spinners() {
  return (
    <Stage>
      <Row label="Spinner">
        {SIZES.map((size) => (
          <Spinner key={size} size={size} aria-label={`加载中 ${size}`} />
        ))}
      </Row>
    </Stage>
  )
}

/** The brand mark, with its opening drawn again on demand. */
function Mark() {
  const [take, setTake] = useState(0)
  return (
    <Stage>
      <Row label="MeridianMark">
        <MeridianMark key={take} intro={take > 0} className="size-16" />
        <Button variant="secondary" size="sm" onPress={() => setTake((n) => n + 1)}>
          重放开场
        </Button>
      </Row>
    </Stage>
  )
}

export default function Core() {
  return (
    <>
      <Section title="Button · 变体 × 尺寸">
        <Buttons />
      </Section>
      <Section title="Badge / Kbd / Link">
        <Chips />
      </Section>
      <Section title="Avatar">
        <Avatars />
      </Section>
      <Section title="Separator">
        <Stage>
          <Separator />
        </Stage>
      </Section>
      <Section title="Spinner">
        <Spinners />
      </Section>
      <Section title="MeridianMark">
        <Mark />
      </Section>
      <CoreParts />
    </>
  )
}
