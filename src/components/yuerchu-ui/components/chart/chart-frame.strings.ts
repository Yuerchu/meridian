import { defineStrings } from "../../lib/i18n";

export const chartFrameStrings = defineStrings(
  {
    chart: "图表",
    view: (v: { name: string }) => `${v.name}的显示方式`,
    table: "表格",
    legend: (v: { name: string }) => `${v.name}的图例：选中的系列显示在图上`,
    data: (v: { name: string }) => `${v.name}的数据`,
    loading: (v: { name: string }) => `${v.name}加载中`,
    empty: "暂无数据",
  },
  {
    chart: "Chart",
    view: (v: { name: string }) => `${v.name} view`,
    table: "Table",
    legend: (v: { name: string }) => `${v.name} legend: selected series are shown`,
    data: (v: { name: string }) => `${v.name} data`,
    loading: (v: { name: string }) => `Loading ${v.name}`,
    empty: "No data",
  },
);
