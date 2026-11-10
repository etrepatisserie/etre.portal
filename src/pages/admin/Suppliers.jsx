import MasterDataPage from '../../components/MasterDataPage.jsx'

export default function Suppliers() {
  return (
    <MasterDataPage
      title="Suppliers"
      endpoint="/admin/suppliers"
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'contact', label: 'Contact person' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone' },
        { name: 'address', label: 'Address' },
      ]}
      columns={[
        { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'contact', label: 'Contact' },
        { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
      ]}
    />
  )
}
