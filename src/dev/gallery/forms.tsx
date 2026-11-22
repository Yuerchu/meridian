import { Select } from '@/components/yuerchu-ui/components/select/select'
import { Label } from '@/components/yuerchu-ui/components/field/field'
import { ListBox, ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Slider } from '@/components/yuerchu-ui/components/slider/slider'
import { Checkbox, CheckboxGroup } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { useState } from 'react'

import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Radio, RadioGroup } from '@/components/yuerchu-ui/components/radio-group/radio-group'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { SearchField } from '@/components/yuerchu-ui/components/search-field/search-field'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { CopyButton } from '@/components/yuerchu-ui/components/copy-button/copy-button'
import { EmojiPicker, type EmojiPack } from '@/components/yuerchu-ui/components/emoji-picker/emoji-picker'
import { Row, Section, Stage } from './shell'

function TextFields() {
  const [name, setName] = useState('my_tool')
  return (
    <Stage>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="名称"
          value={name}
          onChange={setName}
          placeholder="my_tool"
          description="只能用小写字母、数字和下划线。"
        />
        <TextField isInvalid defaultValue="-1" label="超时（秒）" description="必须是正整数。" />
        <TextField isDisabled defaultValue="npx -y @modelcontextprotocol/server" label="命令" />
        <TextField size="sm" label="sm" placeholder="较小的字段" />
      </div>
      <NumberField label="超时（秒）" defaultValue={30} minValue={1} maxValue={600} />
      <PasswordField label="密码（演示）" autoComplete="current-password" defaultValue="demo-only" />
      <CopyButton value="demo-only" label="复制演示文本" />
      <TextArea label="参数" rows={3} placeholder={'每行一个参数'} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SearchField aria-label="搜索表情" placeholder="SearchField" />
        <SearchField aria-label="搜索对话" placeholder="SearchField · 小号" size="sm" />
      </div>
    </Stage>
  )
}

function Choices() {
  const [tools, setTools] = useState(['read'])
  const [mode, setMode] = useState('ask')
  return (
    <Stage>
      <div className="grid gap-6 sm:grid-cols-2">
        <CheckboxGroup value={tools} onChange={setTools} label="工具">
          <Checkbox value="read">读取文件</Checkbox>
          <Checkbox value="write">写入文件</Checkbox>
          <Checkbox value="run" isDisabled>
            运行命令（不可用）
          </Checkbox>
        </CheckboxGroup>
        <RadioGroup value={mode} onChange={setMode} label="审批">
          <Radio value="ask" variant="card" description="每次执行工具前询问。">
            每次询问（推荐）
          </Radio>
          <Radio value="accept" variant="card" description="允许在工作区内编辑文件。">
            接受编辑
          </Radio>
          <Radio value="off" variant="card" isDisabled>
            关闭
          </Radio>
        </RadioGroup>
      </div>
      <Row label="Checkbox 状态">
        <Checkbox defaultSelected>已选中</Checkbox>
        <Checkbox isIndeterminate>部分工具</Checkbox>
        <Checkbox isReadOnly defaultSelected>
          只读
        </Checkbox>
      </Row>
      <Checkbox variant="card" description="允许在工作区内写入文件。" defaultSelected>
        写入文件
      </Checkbox>
    </Stage>
  )
}

function Switches() {
  const [on, setOn] = useState(true)
  return (
    <Stage>
      <Row label="Switch 尺寸">
        {(['sm', 'md'] as const).map((size) => (
          <Switch key={size} size={size} isSelected={on} onChange={setOn}>
            {size}
          </Switch>
        ))}
        <Switch isDisabled>禁用</Switch>
      </Row>
      <Switch variant="card" defaultSelected description="整行可点，说明与名称分别播报。">
        远程访问
      </Switch>
    </Stage>
  )
}

function Pickers() {
  const [range, setRange] = useState('week')
  const [step, setStep] = useState(60)
  const [model, setModel] = useState<string>('sonnet')
  return (
    <Stage>
      <Row label="Segment">
        {(['sm', 'md'] as const).map((size) => (
          <SegmentedControl
            key={size}
            aria-label="范围"
            size={size}
            selectedKey={range}
            onSelectionChange={(key) => setRange(String(key))}
          >
            <Segment id="day">日</Segment>
            <Segment id="week">周</Segment>
            <Segment id="month">月</Segment>
          </SegmentedControl>
        ))}
      </Row>
      <Slider label="温度" value={step} onChange={setStep} minValue={0} maxValue={100} showValue="thumb" />
      <div className="grid gap-4 sm:grid-cols-2">
        {(['md', 'sm'] as const).map((size) => (
          <Select
            key={size}
            label={`Select · ${size}`}
            size={size}
            selectedKey={model}
            onSelectionChange={(key) => setModel(String(key))}
          >
            <ListBoxItem id="sonnet" textValue="claude-sonnet-5">
              claude-sonnet-5
            </ListBoxItem>
            <ListBoxItem id="opus" textValue="claude-opus-5">
              claude-opus-5
            </ListBoxItem>
            <ListBoxItem id="gpt" textValue="gpt-5.6-sol">
              gpt-5.6-sol
            </ListBoxItem>
          </Select>
        ))}
      </div>
    </Stage>
  )
}

const GALLERY_STICKER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/></svg>')}`

const GALLERY_PACK: EmojiPack = {
  id: 'gallery',
  label: '演示',
  kind: 'sticker',
  items: [{ id: 'dot', label: '圆点', keywords: ['dot'], src: GALLERY_STICKER }],
}

/** The panel the composer opens. Unicode is the first tab; a pack is a tab beside it. */
function EmojiPanel() {
  const [picked, setPicked] = useState('未选择')
  return (
    <Stage>
      <EmojiPicker
        aria-label="选择表情"
        packs={[GALLERY_PACK]}
        onSelect={setPicked}
        onSelectItem={(selection) => {
          setPicked(selection.kind === 'unicode' ? selection.emoji : selection.item.label)
        }}
      />
      <output aria-label="已选内容">{picked}</output>
    </Stage>
  )
}

export default function Forms() {
  return (
    <>
      <Section title="TextField / Input / TextArea / SearchField">
        <TextFields />
      </Section>
      <Section title="Checkbox / Radio">
        <Choices />
      </Section>
      <Section title="Switch / CellSwitch">
        <Switches />
      </Section>
      <Section title="Segment / Slider / Select">
        <Pickers />
      </Section>
      <Section title="ListBox / Label（库）">
        <Stage>
          <Label>移动到</Label>
          <ListBox aria-label="移动到" selectionMode="single" defaultSelectedKeys={['meridian']}>
            <ListBoxItem id="none">不属于任何项目</ListBoxItem>
            <ListBoxItem id="meridian">meridian</ListBoxItem>
            <ListBoxItem id="core" description="Apache-2.0 子模块">
              meridian-core
            </ListBoxItem>
          </ListBox>
        </Stage>
      </Section>
      <Section title="EmojiPicker（库）">
        <EmojiPanel />
      </Section>
    </>
  )
}
