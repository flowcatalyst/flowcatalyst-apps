export interface NavItem {
  label: string;
  icon: string;
  route?: string;
  children?: NavItem[];
  expanded?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}
