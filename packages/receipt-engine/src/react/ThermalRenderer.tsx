import { QRCodeSVG } from 'qrcode.react';
import type { ReceiptViewModel } from '../types';
import { formatCurrency } from '../formatCurrency';
import { copyLabel, receiptTitle, formatPaymentMethod } from '../receiptSections';
import './thermal.css';

export interface ThermalRendererProps {
  viewModel: ReceiptViewModel;
  className?: string;
}

function Divider({ char = '=' }: { char?: string }) {
  return <div className="receipt-divider">{char.repeat(48)}</div>;
}

function Dashed() {
  return <div className="receipt-dashed">{'-'.repeat(48)}</div>;
}

export function ThermalRenderer({ viewModel: vm, className = '' }: ThermalRendererProps) {
  const copy = copyLabel(vm);
  const showCashTender =
    vm.payment.method.toUpperCase() === 'CASH' &&
    vm.payment.amountPaid != null &&
    vm.payment.amountPaid > 0;

  return (
    <div className={`receipt-thermal ${className}`} id="receipt-print-area">
      {copy && <div className="receipt-copy-banner">{copy}</div>}

      <div className="receipt-header">
        {vm.merchant.logoUrl ? (
          <img src={vm.merchant.logoUrl} alt={vm.merchant.brand} className="receipt-logo" />
        ) : (
          <div className="receipt-brand">{vm.merchant.brand}</div>
        )}
        <div className="receipt-doc-title">{receiptTitle(vm)}</div>
      </div>

      <Divider char="=" />

      <div className="receipt-block">
        <div>Store: {vm.merchant.tradingName}</div>
        <div>TPIN: {vm.merchant.tpin}</div>
        <div>Branch: {vm.merchant.branchName}</div>
        {vm.merchant.address && <div>{vm.merchant.address}</div>}
        {vm.merchant.phone && <div>Phone: {vm.merchant.phone}</div>}
      </div>

      <Dashed />

      <div className="receipt-block receipt-row-pair">
        <div>
          <div>Date: {vm.transaction.date}</div>
          <div>Time: {vm.transaction.time}</div>
          <div>Cashier: {vm.transaction.cashier}</div>
        </div>
        <div className="receipt-right">
          {vm.transaction.receiptNo && <div>Receipt: {vm.transaction.receiptNo}</div>}
          {vm.transaction.invoiceNo && <div>Invoice: {vm.transaction.invoiceNo}</div>}
          <div>Items: {vm.transaction.itemCount}</div>
        </div>
      </div>

      <Dashed />

      <table className="receipt-items">
        <thead>
          <tr>
            <th>ITEM</th>
            <th>QTY</th>
            <th>PRICE</th>
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {vm.items.map((item, i) => (
            <tr key={i}>
              <td>{item.name}</td>
              <td>{item.qty}</td>
              <td>{formatCurrency(item.unitPrice)}</td>
              <td>{formatCurrency(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dashed />

      <div className="receipt-totals">
        <div className="receipt-total-row">
          <span>Subtotal</span>
          <span>{formatCurrency(vm.totals.subtotal)}</span>
        </div>
        {vm.totals.vatBreakdown.length > 1 ? (
          vm.totals.vatBreakdown.map((entry, i) => (
            <div className="receipt-total-row" key={i}>
              <span>{entry.label}</span>
              <span>{formatCurrency(entry.vat)}</span>
            </div>
          ))
        ) : (
          <div className="receipt-total-row">
            <span>{vm.totals.vatLabel}</span>
            <span>{formatCurrency(vm.totals.vat)}</span>
          </div>
        )}
        <div className="receipt-total-row">
          <span>{vm.totals.discountLabel}</span>
          <span>{formatCurrency(vm.totals.discount)}</span>
        </div>
        <div className="receipt-total-row receipt-grand">
          <span>TOTAL</span>
          <span>{formatCurrency(vm.totals.total)}</span>
        </div>
      </div>

      <div className="receipt-block">
        <div>Payment: {formatPaymentMethod(vm.payment.method)}</div>
        {showCashTender && (
          <>
            <div>Paid: {formatCurrency(vm.payment.amountPaid)}</div>
            <div>Change: {formatCurrency(vm.payment.change)}</div>
          </>
        )}
      </div>

      <Divider char="=" />

      <div className="receipt-fiscal-title">ZRA SMART INVOICE DETAILS</div>
      <Divider char="=" />

      <div className="receipt-block receipt-fiscal">
        {vm.fiscal.sdcId && <div>SDC ID: {vm.fiscal.sdcId}</div>}
        {vm.fiscal.fiscalReceiptNo && <div>Fiscal Receipt No: {vm.fiscal.fiscalReceiptNo}</div>}
        {vm.fiscal.receiptSignature && <div>Receipt Signature: {vm.fiscal.receiptSignature}</div>}
        {vm.fiscal.internalData && <div>Internal Data: {vm.fiscal.internalData}</div>}
        {vm.fiscal.verificationCode && <div>Verification Code: {vm.fiscal.verificationCode}</div>}
        {vm.receiptMeta.originalReceiptNo && (
          <div>Original Receipt: {vm.receiptMeta.originalReceiptNo}</div>
        )}
      </div>

      {vm.fiscal.qrPayload && (
        <div className="receipt-qr">
          <QRCodeSVG value={vm.fiscal.qrPayload} size={160} level="M" includeMargin />
          <div className="receipt-qr-caption">Scan to verify on ZRA Smart Invoice</div>
        </div>
      )}

      <Divider char="=" />

      <div className="receipt-block receipt-customer">
        {vm.customer.showTpin && vm.customer.tpin && (
          <div>Customer TPIN: {vm.customer.tpin}</div>
        )}
        <div>Customer: {vm.customer.name}</div>
        {vm.customer.address && <div>{vm.customer.address}</div>}
      </div>

      <div className="receipt-footer-lines">
        {vm.footer.lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>

      {vm.footer.showPoweredBy && (
        <div className="receipt-powered">
          <div>{vm.footer.poweredByLine}</div>
          <div>{vm.footer.fiscalizedLine}</div>
        </div>
      )}
    </div>
  );
}

export { ThermalRenderer as default };
