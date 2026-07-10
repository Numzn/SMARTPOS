import type { ReceiptViewModel } from '../types';
import { A4Renderer } from './A4Renderer';
import { ThermalRenderer } from './ThermalRenderer';

export type ReceiptFormat = 'thermal' | 'a4';

export interface ReceiptRendererProps {
  viewModel: ReceiptViewModel;
  format?: ReceiptFormat;
  className?: string;
}

export function ReceiptRenderer({
  viewModel,
  format = 'thermal',
  className = '',
}: ReceiptRendererProps) {
  if (format === 'a4') {
    return <A4Renderer viewModel={viewModel} className={className} />;
  }
  return <ThermalRenderer viewModel={viewModel} className={className} />;
}

export { ReceiptRenderer as default };
