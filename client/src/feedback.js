import { createContext, useContext } from 'react'

// App-wide feedback: toasts after actions and a confirm dialog before destructive ones.
//   const toast = useToast();   toast.success('Invoice issued') · toast.error(e.message) · toast.info('…')
//   const confirm = useConfirm(); if (await confirm({ title: 'Cancel this order?', body: '…', confirmLabel: 'Cancel order', danger: true })) …
// The provider is <FeedbackProvider> (components/FeedbackProvider.jsx), mounted once in main.jsx.
export const FeedbackContext = createContext(null)

const noop = { toast: { success() {}, error() {}, info() {} }, confirm: async () => window.confirm('Are you sure?') }
export const useToast = () => (useContext(FeedbackContext) || noop).toast
export const useConfirm = () => (useContext(FeedbackContext) || noop).confirm
