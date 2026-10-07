import { useState } from 'react'
import { Bin, Bookmark, Messages, Plus, Sparkles } from '@keyline-icons/react/two-tone'

import {
  Avatar,
  Button,
  Card,
  Chip,
  CloseButton,
  Kbd,
  LinkButton,
  Separator,
  Spinner,
  ToggleButton,
  type ButtonVariant,
} from '@/components/base'
import { noop } from './fixtures'
import { Row, Section, Stage } from './shell'

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'neutral']
const SIZES = ['medium', 'small', 'xs'] as const
const CHIP_VARIANTS = ['primary', 'secondary', 'soft', 'tertiary'] as const
const CHIP_COLORS = ['default', 'accent', 'success', 'warning', 'danger'] as const

function Buttons() {
  return (
    <Stage>
      {SIZES.map((size) => (
        <Row key={size} label={size}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size} leadingIcon={variant === 'danger' ? Bin : Plus}>
              {variant}
            </Button>
          ))}
          <Button size={size} variant="neutral" iconOnly leadingIcon={Sparkles} aria-label="仅图标" />
        </Row>
      ))}
      <Row label="状态">
        <Button isPending>保存中</Button>
        <Button isDisabled>不可用</Button>
        <Button variant="secondary" isDisabled>
          不可用
        </Button>
        <Button variant="danger" isDisabled>
          不可用
        </Button>
      </Row>
    </Stage>
  )
}

function Toggles() {
  const [on, setOn] = useState(true)
  return (
    <Stage>
      <Row label="ToggleButton">
        <ToggleButton isSelected={on} onChange={setOn}>
          <Bookmark className="size-5" aria-hidden />
          {on ? '已收藏' : '收藏'}
        </ToggleButton>
        <ToggleButton size="small">small</ToggleButton>
      </Row>
      <Row label="LinkButton">
        <LinkButton onPress={noop}>primary</LinkButton>
        <LinkButton variant="secondary" leadingIcon={Messages} onPress={noop}>
          secondary
        </LinkButton>
        <LinkButton size="xs" onPress={noop}>
          xs
        </LinkButton>
      </Row>
      <Row label="CloseButton">
        {(['2xs', 'xs', 'sm', 'md'] as const).map((size) => (
          <CloseButton key={size} size={size} aria-label={`关闭 ${size}`} onPress={noop} />
        ))}
      </Row>
    </Stage>
  )
}

function Chips() {
  return (
    <Stage>
      {CHIP_VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          {CHIP_COLORS.map((color) => (
            <Chip key={color} variant={variant} color={color}>
              {color}
            </Chip>
          ))}
        </Row>
      ))}
      <Row label="尺寸">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Chip key={size} size={size} variant="soft" color="accent">
            {size}
          </Chip>
        ))}
      </Row>
      <Row label="Kbd">
        <Kbd>Ctrl K</Kbd>
        <Kbd>⇧ Enter</Kbd>
        <Kbd>Esc</Kbd>
      </Row>
    </Stage>
  )
}

function Avatars() {
  return (
    <Stage>
      {(['neutral', 'blue', 'lime', 'pink'] as const).map((color) => (
        <Row key={color} label={color}>
          {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
            <Avatar key={size} size={size} color={color} initials="于" alt="于小丘" />
          ))}
        </Row>
      ))}
    </Stage>
  )
}

function Cards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(['primary', 'secondary'] as const).map((variant) => (
        <Card key={variant} variant={variant}>
          <Card.Header>
            <Card.Title>MCP 服务器</Card.Title>
            <Card.Description>为智能体扩展更多工具。（{variant}）</Card.Description>
          </Card.Header>
          <Card.Content className="px-4 pb-4">
            <Separator />
          </Card.Content>
          <Card.Footer>
            <Button size="small" variant="secondary">
              添加
            </Button>
          </Card.Footer>
        </Card>
      ))}
    </div>
  )
}

function Spinners() {
  return (
    <Stage>
      {(['current', 'accent', 'success', 'warning', 'danger'] as const).map((color) => (
        <Row key={color} label={color}>
          {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
            <Spinner key={size} size={size} color={color} aria-label={`${color} ${size}`} />
          ))}
        </Row>
      ))}
    </Stage>
  )
}

export default function Core() {
  return (
    <>
      <Section title="Button · 变体 × 尺寸">
        <Buttons />
      </Section>
      <Section title="ToggleButton / LinkButton / CloseButton">
        <Toggles />
      </Section>
      <Section title="Chip / Kbd">
        <Chips />
      </Section>
      <Section title="Avatar">
        <Avatars />
      </Section>
      <Section title="Card / Separator">
        <Cards />
      </Section>
      <Section title="Spinner">
        <Spinners />
      </Section>
    </>
  )
}
