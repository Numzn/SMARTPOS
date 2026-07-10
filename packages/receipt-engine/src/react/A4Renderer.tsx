import { QRCodeSVG } from 'qrcode.react';
import type { ReceiptViewModel } from '../types';
import { formatCurrency } from '../formatCurrency';
import { copyLabel, receiptTitle, formatPaymentMethod } from '../receiptSections';
import './a4.css';

export interface A4RendererProps {
  viewModel: ReceiptViewModel;
  className?: string;
}

export function A4Renderer({ viewModel: vm, className = '' }: A4RendererProps) {
  const copy = copyLabel(vm);
  const showCashTender =
    vm.payment.method.toUpperCase() === 'CASH' &&
    vm.payment.amountPaid != null &&
    vm.payment.amountPaid > 0;

  return (
    <div className={`receipt-a4 ${className}`} id="receipt-print-area">
      {copy && <div className="receipt-a4-copy">{copy}</div>}

      <header className="receipt-a4-header">
        <div className="receipt-a4-brand-block">
          {vm.merchant.logoUrl ? (
            <img src={vm.merchant.logoUrl} alt={vm.merchant.brand} className="receipt-a4-logo" />
          ) : (
            <div className="receipt-a4-brand">{vm.merchant.brand}</div>
          )}
          <div className="receipt-a4-trading">{vm.merchant.tradingName}</div>
          <div className="receipt-a4-meta">
            TPIN: {vm.merchant.tpin} · Branch: {vm.merchant.branchName}
          </div>
          {vm.merchant.address && <div className="receipt-a4-meta">{vm.merchant.address}</div>}
          {vm.merchant.phone && <div className="receipt-a4-meta">Tel: {vm.merchant.phone}</div>}
        </div>
        <div className="receipt-a4-title-block">
          <h1 className="receipt-a4-title">{receiptTitle(vm)}</h1>
          {vm.transaction.invoiceNo && (
            <div className="receipt-a4-invoice">Invoice {vm.transaction.invoiceNo}</div>
          )}
          {vm.transaction.receiptNo && (
            <div className="receipt-a4-invoice">Receipt {vm.transaction.receiptNo}</div>
          )}
        </div>
      </header>

      <section className="receipt-a4-info">
        <div>
          <div>
            <strong>Date:</strong> {vm.transaction.date}
          </div>
          <div>
            <strong>Time:</strong> {vm.transaction.time}
          </div>
          <div>
            <strong>Cashier:</strong> {vm.transaction.cashier}
          </div>
        </div>
        <div className="receipt-a4-info-right">
          <div>
            <strong>Customer:</strong> {vm.customer.name}
          </div>
          {vm.customer.showTpin && vm.customer.tpin && (
            <div>
              <strong>Customer TPIN:</strong> {vm.customer.tpin}
            </div>
          )}
          <div>
            <strong>Items:</strong> {vm.transaction.itemCount}
          </div>
        </div>
      </section>

      <table className="receipt-a4-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit price</th>
            <th>Line total</th>
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

      <div className="receipt-a4-bottom">
        <section className="receipt-a4-fiscal">
          <h2>ZRA Smart Invoice</h2>
          {vm.fiscal.sdcId && <div>SDC ID: {vm.fiscal.sdcId}</div>}
          {vm.fiscal.fiscalReceiptNo && <div>Fiscal receipt: {vm.fiscal.fiscalReceiptNo}</div>}
          {vm.fiscal.receiptSignature && <div>Signature: {vm.fiscal.receiptSignature}</div>}
          {vm.fiscal.verificationCode && <div>Verification: {vm.fiscal.verificationCode}</div>}
          {vm.receiptMeta.originalReceiptNo && (
            <div>Original receipt: {vm.receiptMeta.originalReceiptNo}</div>
          )}
        </section>

        <section className="receipt-a4-totals">
          <div className="receipt-a4-total-row">
            <span>Subtotal</span>
            <span>{formatCurrency(vm.totals.subtotal)}</span>
          </div>
          <div className="receipt-a4-total-row">
            <span>{vm.totals.vatLabel}</span>
            <span>{formatCurrency(vm.totals.vat)}</span>
          </div>
          <div className="receipt-a4-total-row">
            <span>Discount</span>
            <span>{formatCurrency(vm.totals.discount)}</span>
          </div>
          <div className="receipt-a4-total-row receipt-a4-grand">
            <span>Total</span>
            <span>{formatCurrency(vm.totals.total)}</span>
          </div>
          <div className="receipt-a4-payment">
            <div>Payment: {formatPaymentMethod(vm.payment.method)}</div>
            {showCashTender && (
              <>
                <div>Paid: {formatCurrency(vm.payment.amountPaid)}</div>
                <div>Change: {formatCurrency(vm.payment.change)}</div>
              </>
            )}
          </div>
          {vm.fiscal.qrPayload && (
            <div className="receipt-a4-qr">
              <QRCodeSVG value={vm.fiscal.qrPayload} size={120} level="M" includeMargin />
              <div>Scan to verify on ZRA Smart Invoice</div>
            </div>
          )}
        </section>
      </div>

      <footer className="receipt-a4-footer">
        {vm.footer.lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {vm.footer.showPoweredBy && (
          <div className="receipt-a4-powered">
            {vm.footer.poweredByLine} · {vm.footer.fiscalizedLine}
          </div>
        )}
      </footer>
    </div>
  );
}

export { A4Renderer as default };
