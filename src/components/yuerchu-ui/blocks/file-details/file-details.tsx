"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  CheckboxGroupContext,
  ComboBoxContext,
  NumberFieldContext,
  Provider,
  RadioGroupContext,
  SelectContext,
  SwitchContext,
  TextFieldContext,
} from "react-aria-components";
import { Avatar } from "../../components/avatar/avatar";
import { Button } from "../../components/button/button";
import { Dialog } from "../../components/dialog/dialog";
import { InlineEdit } from "../../components/inline-edit/inline-edit";
import { ListBoxItem } from "../../components/listbox/listbox";
import { Rating } from "../../components/rating/rating";
import { Select } from "../../components/select/select";
import { SettingsGroup, SettingsRow } from "../../components/settings-list/settings-list";
import { Switch } from "../../components/switch/switch";
import { Tab, TabList, TabPanel, Tabs } from "../../components/tabs/tabs";
import { TagField } from "../../components/tag-field/tag-field";
import type { TimelineItem } from "../../components/timeline/timeline";
import { Timeline } from "../../components/timeline/timeline";
import { Tray, TrayPanel } from "../../components/tray/tray";
import { useStrings } from "../../lib/i18n";
import { ArrowUpRightIcon, XIcon } from "../../lib/icons";
import { fileDetailsStrings } from "./file-details.strings";
import "./file-details.css";

/**
 * 用于展示与编辑单个文件的详情、标签、自定义属性、协作成员权限及操作动态，支持宽屏侧栏与窄屏对话框自适应切换。
 *
 * @packageDocumentation
 * @category 文件
 * @status 实验中
 */

export interface FileInfoItem {
  /** 信息项名称，例如“大小”。 */
  label: string;
  /** 信息项取值，例如“2.4 MB”。 */
  value: ReactNode;
}

export interface FilePropertyOption {
  id: string;
  label: string;
  /** 用户选项的头像地址。 */
  avatar?: string;
}

type PropertyBase = { id: string; label: string; description?: string };
export type FileProperty = PropertyBase & (
  | { type: "text"; value: string }
  | { type: "number"; value: number | null; formatOptions?: Intl.NumberFormatOptions }
  | { type: "boolean"; value: boolean }
  | { type: "select"; value: string | null; options: FilePropertyOption[] }
  | { type: "multiselect"; value: string[]; options: FilePropertyOption[] }
  | { type: "link"; value: string }
  | { type: "rating"; value: number }
  | { type: "user"; value: string | null; options: FilePropertyOption[] }
);

export type FilePropertyValue = string | number | boolean | string[] | null;

export interface FilePermission {
  /** 成员或用户组的唯一标识。 */
  id: string;
  name: string;
  avatar?: string;
  /** 当前角色（对应 `roles` 中的 `id`），所有者传入 `"owner"`（仅展示不可修改）。 */
  role: string;
}

export interface FileDetailsProps {
  /** 文件名称，同时作为侧栏或对话框的标题。 */
  heading: string;
  /** 预览区域内容，通常传入缩略图或文件图标。 */
  preview?: ReactNode;
  /** 文件基本信息列表，如类型、大小、路径和更新时间。 */
  info: FileInfoItem[];
  /** 媒体元数据列表，如分辨率、色彩空间和拍摄设备。 */
  media?: FileInfoItem[];
  /** 当前文件的标签列表，传入 `onTagsChange` 时支持编辑。 */
  tags?: string[];
  /** 输入标签时提供的候选项列表。 */
  tagOptions?: string[];
  /** 标签变化回调；省略时标签处于只读状态。 */
  onTagsChange?: (tags: string[]) => void;
  /** 自定义属性配置列表。 */
  properties?: FileProperty[];
  /** 属性变更回调；返回 Promise 时文本、数字与链接编辑器会等待完成，失败则保持编辑态并提示错误。 */
  onPropertyChange?: (id: string, value: FilePropertyValue) => void | Promise<void>;
  /** 协作成员权限列表；省略时不显示“权限”分页。 */
  permissions?: FilePermission[];
  /** 可分配的角色选项列表，例如“可查看”或“可编辑”。 */
  roles?: FilePropertyOption[];
  /** 成员角色变更回调；省略时权限列表处于只读状态。 */
  onRoleChange?: (personId: string, role: string) => void;
  /** 文件操作动态列表；省略时不显示“动态”分页。 */
  activity?: TimelineItem[];
  /** 受控打开状态；省略时保持常驻显示。 */
  isOpen?: boolean;
  /** 关闭或打开状态变化回调；传入时在侧栏右上角显示关闭按钮。 */
  onOpenChange?: (open: boolean) => void;
  /**
   * 视口宽度小于该阈值（px）时自动切换为对话框展示。
   * @default 720
   */
  dialogBelow?: number;
  /** 侧栏根元素的自定义类名。 */
  className?: string;
}

/**
 * SettingsRow 会通过 context 为行内控件注入指向行标签的 aria-labelledby，而此处的编辑器自带可访问名称（InlineEdit 必填），
 * 两者共存会导致读屏重复播报（如“标题 标题”）；清除行级 context 可确保每个控件仅保留自身名称。
 */
function OwnLabel({ children }: { children: ReactNode }) {
  return (
    <Provider
      values={[
        [SwitchContext, null],
        [SelectContext, null],
        [ComboBoxContext, null],
        [TextFieldContext, null],
        [NumberFieldContext, null],
        [RadioGroupContext, null],
        [CheckboxGroupContext, null],
      ]}
    >
      {children}
    </Provider>
  );
}

/** 窗口宽度是否小于 px（服务端渲染时当作宽屏） */
function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(max-width: ${px - 0.02}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [px]);
  return narrow;
}

/**
 * 渲染文件详情侧栏或窄屏对话框，并将内容组织为“详情”、“权限”和“动态”三个按需展示的分页。
 */
export function FileDetails(props: FileDetailsProps) {
  const { heading, isOpen = true, onOpenChange, dialogBelow = 720, className } = props;
  const t = useStrings(fileDetailsStrings);
  const narrow = useNarrow(dialogBelow);
  if (!isOpen) return null;
  if (narrow) {
    return (
      <Dialog isOpen heading={heading} size="lg" onOpenChange={(open) => { if (!open) onOpenChange?.(false); }}>
        <DetailsContent {...props} />
      </Dialog>
    );
  }
  return (
    <div className={className ? `ui-block-file-details ${className}` : "ui-block-file-details"}>
      <Tray
        heading={heading}
        headingLevel={2}
        actions={onOpenChange ? <Button variant="ghost" size="sm" icon={<XIcon />} aria-label={t.close} onPress={() => onOpenChange(false)} /> : undefined}
      >
        <TrayPanel>
          <DetailsContent {...props} />
        </TrayPanel>
      </Tray>
    </div>
  );
}

function DetailsContent({ preview, info, media, tags, tagOptions, onTagsChange, properties, onPropertyChange, permissions, roles, onRoleChange, activity }: FileDetailsProps) {
  const t = useStrings(fileDetailsStrings);
  return (
    <Tabs className="ui-block-file-details__tabs">
      <TabList aria-label={t.sections}>
        <Tab id="details">{t.details}</Tab>
        {permissions ? <Tab id="sharing">{t.sharing}</Tab> : null}
        {activity ? <Tab id="activity">{t.activity}</Tab> : null}
      </TabList>
      <TabPanel id="details">
        <div className="ui-block-file-details__stack">
          {preview ? <div className="ui-block-file-details__preview">{preview}</div> : null}
          <SettingsGroup heading={t.basic} headingLevel={3}>
            {info.map((item) => <SettingsRow key={item.label} label={item.label}>{item.value}</SettingsRow>)}
          </SettingsGroup>
          {media?.length ? (
            <SettingsGroup heading={t.media} headingLevel={3}>
              {media.map((item) => <SettingsRow key={item.label} label={item.label}>{item.value}</SettingsRow>)}
            </SettingsGroup>
          ) : null}
          {tags ? (
            <TagField label={t.tags} placeholder={t.tagsPlaceholder} value={tags} onChange={onTagsChange}
              options={tagOptions?.map((tag) => ({ id: tag, label: tag }))} allowsCreate isReadOnly={!onTagsChange} />
          ) : null}
          {properties?.length ? (
            <SettingsGroup heading={t.properties} headingLevel={3}>
              {properties.map((property) => (
                <SettingsRow key={property.id} label={property.label} description={property.description}>
                  <OwnLabel>
                    <PropertyEditor property={property} onChange={onPropertyChange} />
                  </OwnLabel>
                </SettingsRow>
              ))}
            </SettingsGroup>
          ) : null}
        </div>
      </TabPanel>
      {permissions ? (
        <TabPanel id="sharing">
          <SettingsGroup heading={t.people} headingLevel={3}>
            {permissions.map((person) => (
              <SettingsRow key={person.id} label={<span className="ui-block-file-details__person"><Avatar name={person.name} src={person.avatar} size="sm" isDecorative />{person.name}</span>}>
                {person.role === "owner" ? t.owner : (
                  <OwnLabel>
                  <Select aria-label={t.role({ name: person.name })} selectedKey={person.role} isDisabled={!onRoleChange}
                    onSelectionChange={(key) => { if (key !== null) onRoleChange?.(person.id, String(key)); }}>
                    {(roles ?? []).map((role) => <ListBoxItem key={role.id} id={role.id}>{role.label}</ListBoxItem>)}
                  </Select>
                  </OwnLabel>
                )}
              </SettingsRow>
            ))}
          </SettingsGroup>
        </TabPanel>
      ) : null}
      {activity ? (
        <TabPanel id="activity">
          {activity.length ? <Timeline items={activity} aria-label={t.activity} /> : <p>{t.noActivity}</p>}
        </TabPanel>
      ) : null}
    </Tabs>
  );
}

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

function PropertyEditor({ property, onChange }: { property: FileProperty; onChange?: FileDetailsProps["onPropertyChange"] }) {
  const t = useStrings(fileDetailsStrings);
  const disabled = !onChange;
  const commit = (value: FilePropertyValue) => onChange?.(property.id, value);
  switch (property.type) {
    case "text":
      return <InlineEdit aria-label={property.label} value={property.value} isDisabled={disabled} onCommit={commit} />;
    case "number":
      return (
        <InlineEdit aria-label={property.label} type="number" value={property.value === null ? "" : String(property.value)}
          formatOptions={property.formatOptions} isDisabled={disabled} onCommit={(v) => commit(v === "" ? null : Number(v))} />
      );
    case "select":
      return (
        <InlineEdit aria-label={property.label} type="select" value={property.value ?? ""}
          options={property.options.map(({ id, label }) => ({ id, label }))} isDisabled={disabled} onCommit={(v) => commit(v || null)} />
      );
    case "boolean":
      return <Switch aria-label={property.label} isSelected={property.value} isDisabled={disabled} onChange={(v) => void commit(v)} />;
    case "multiselect":
      return (
        <TagField aria-label={property.label} size="sm" value={property.value} isReadOnly={disabled}
          options={property.options.map(({ id, label }) => ({ id, label }))} onChange={(v) => void commit(v)} />
      );
    case "link":
      return (
        <span className="ui-block-file-details__link">
          <InlineEdit aria-label={property.label} value={property.value} isDisabled={disabled}
            validate={(v) => (v.trim() === "" || isLink(v) ? null : t.invalidLink)} onCommit={(v) => commit(v.trim())} />
          {isLink(property.value) ? (
            <Button variant="ghost" size="sm" icon={<ArrowUpRightIcon />} href={property.value} aria-label={t.openLink({ label: property.label })} />
          ) : null}
        </span>
      );
    case "rating":
      return <Rating aria-label={property.label} value={property.value} isReadOnly={disabled} onChange={(v) => void commit(v)} />;
    case "user":
      return (
        <Select aria-label={property.label} placeholder={t.unassigned} selectedKey={property.value} isDisabled={disabled}
          onSelectionChange={(key) => void commit(key === null ? null : String(key))}>
          {property.options.map((option) => <ListBoxItem key={option.id} id={option.id} textValue={option.label}>{option.label}</ListBoxItem>)}
        </Select>
      );
  }
}
