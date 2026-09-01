// app/_components/ui/index.ts — the design-system barrel.
export { Button, LinkButton, IconButton } from './button'
export type { ButtonProps } from './button'
export { TextInput, TextArea, SelectInput, Checkbox, SearchInput, controlClass } from './form'
export { Combobox } from './combobox'
export type { ComboboxItem } from './combobox'
export { Badge, StatusBadge, Pill, Avatar } from './badge'
export { Card, CardHeader, CardBody, DataRow } from './card'
export {
  Spinner,
  Skeleton,
  SkeletonRows,
  EmptyState,
  ErrorState,
  Callout,
  AsyncBoundary,
} from './feedback'
export { PageHeader, Section } from './page'
export { Table, THead, Th, Tr, Td } from './table'
export { Pagination } from './pagination'
export { Tabs, makePanelProps } from './tabs'
export type { TabItem } from './tabs'
export { Dialog, Drawer } from './overlay'
export { Menu } from './menu'
export type { MenuItem } from './menu'
export { ToastProvider, useToast } from './toast'
export { ConfirmProvider, useConfirm } from './confirm'
export type { ConfirmOptions } from './confirm'
