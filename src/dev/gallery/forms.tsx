import { useState } from 'react'
import { Search } from '@keyline-icons/react/two-tone'

import {
  CellSwitch,
  Checkbox,
  CheckboxGroup,
  Description,
  Input,
  InputGroup,
  Label,
  Radio,
  RadioGroup,
  SearchField,
  Segment,
  Select,
  SelectItem,
  Slider,
  Switch,
  TextArea,
  TextField,
} from '@/components/base'
import { Row, Section, Stage } from './shell'

function TextFields() {
  const [name, setName] = useState('my_tool')
  return (
    <Stage>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField>
          <Label>名称</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_tool" />
          <Description>只能用小写字母、数字和下划线。</Description>
        </TextField>
        <TextField isInvalid defaultValue="-1">
          <Label>超时（秒）</Label>
          <Input />
          <Description>必须是正整数。</Description>
        </TextField>
        <TextField isDisabled defaultValue="npx -y @modelcontextprotocol/server">
          <Label>命令</Label>
          <Input />
        </TextField>
        <TextField size="small">
          <Label>small</Label>
          <Input placeholder="较小的字段" />
        </TextField>
      </div>
      <TextField>
        <Label>参数</Label>
        <TextArea rows={3} placeholder={'每行一个参数'} />
      </TextField>
      <div className="grid gap-4 sm:grid-cols-2">
        <SearchField aria-label="搜索表情">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="SearchField" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
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
        <CheckboxGroup value={tools} onChange={setTools} aria-label="工具">
          <Checkbox value="read">读取文件</Checkbox>
          <Checkbox value="write">写入文件</Checkbox>
          <Checkbox value="run" isDisabled>
            运行命令（不可用）
          </Checkbox>
          <Checkbox isIndeterminate>部分工具</Checkbox>
        </CheckboxGroup>
        <RadioGroup value={mode} onChange={setMode} aria-label="审批">
          <Radio value="ask" size="md">
            每次询问（推荐）
          </Radio>
          <Radio value="accept" size="md">
            接受编辑
          </Radio>
          <Radio value="off" size="md">
            关闭
          </Radio>
        </RadioGroup>
      </div>
      <Row label="Checkbox 尺寸">
        <Checkbox size="sm" defaultSelected>
          sm
        </Checkbox>
        <Checkbox size="md" defaultSelected>
          md
        </Checkbox>
      </Row>
    </Stage>
  )
}

function Switches() {
  const [on, setOn] = useState(true)
  return (
    <Stage>
      {(['pill', 'rectangle'] as const).map((shape) => (
        <Row key={shape} label={shape}>
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Switch key={size} size={size} shape={shape} isSelected={on} onChange={setOn}>
              <span className="text-body-2-medium text-text-secondary">{size}</span>
            </Switch>
          ))}
          <Switch shape={shape} isDisabled>
            <span className="text-body-2-medium text-text-secondary">禁用</span>
          </Switch>
        </Row>
      ))}
      <div className="flex flex-col gap-1">
        <CellSwitch aria-label="远程访问" aria-describedby="pg-cell-hint" defaultSelected>
          <CellSwitch.Trigger>
            <CellSwitch.Label>远程访问</CellSwitch.Label>
            <CellSwitch.Control />
          </CellSwitch.Trigger>
        </CellSwitch>
        <p id="pg-cell-hint" className="text-caption-1-regular text-text-secondary">
          CellSwitch：整行可点，说明写在行外。
        </p>
      </div>
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
      <Slider label="温度" value={step} onChange={setStep} minValue={0} maxValue={100} thumbLabel="温度" />
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
