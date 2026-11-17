import { Slider } from '@/components/yuerchu-ui/components/slider/slider'
import { Checkbox, CheckboxGroup } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { useState } from 'react'
import { Search } from '@keyline-icons/react/two-tone'

import { InputGroup, Segment, Select, SelectItem } from '@/components/base'
import { Radio, RadioGroup } from '@/components/yuerchu-ui/components/radio-group/radio-group'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { SearchField } from '@/components/yuerchu-ui/components/search-field/search-field'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { CopyButton } from '@/components/yuerchu-ui/components/copy-button/copy-button'
import { ChevronDownSmall } from '@/components/foundations/icons/chevrons'
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
        <InputGroup>
          <InputGroup.Prefix>
            <Search className="size-4" />
          </InputGroup.Prefix>
          <InputGroup.Input aria-label="InputGroup" placeholder="InputGroup" />
        </InputGroup>
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
          <Segment key={size} aria-label="范围" size={size} selectedKey={range} onSelectionChange={setRange}>
            <Segment.Item id="day">日</Segment.Item>
            <Segment.Item id="week">周</Segment.Item>
            <Segment.Item id="month">月</Segment.Item>
          </Segment>
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
            <SelectItem id="sonnet" textValue="claude-sonnet-5">
              claude-sonnet-5
            </SelectItem>
            <SelectItem id="opus" textValue="claude-opus-5">
              claude-opus-5
            </SelectItem>
            <SelectItem id="gpt" textValue="gpt-5.6-sol">
              gpt-5.6-sol
            </SelectItem>
          </Select>
        ))}
      </div>
      <Row label="ChevronDownSmall">
        <ChevronDownSmall className="size-4 text-text-secondary" />
      </Row>
    </Stage>
  )
}

export default function Forms() {
  return (
    <>
      <Section title="TextField / Input / TextArea / SearchField / InputGroup">
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
    </>
  )
}
