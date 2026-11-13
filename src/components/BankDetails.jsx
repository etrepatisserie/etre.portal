// Bank transfer is the only payment method — shown on checkout, payments page and invoices
export default function BankDetails({ bank, reference }) {
  if (!bank) return null
  return (
    <div className="bank-box">
      <div className="bank-title">Payment by bank transfer only</div>
      <dl>
        <dt>Bank</dt><dd>{bank.bank}</dd>
        <dt>Account name</dt><dd>{bank.account_name}</dd>
        <dt>Account no.</dt><dd className="mono">{bank.account_no}</dd>
      </dl>
      {reference && <div className="small muted">Please quote {reference} as the payment reference.</div>}
    </div>
  )
}
