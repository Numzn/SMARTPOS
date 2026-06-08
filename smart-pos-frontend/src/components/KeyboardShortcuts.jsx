const KeyboardShortcuts = ({ onClose }) => {
  const shortcuts = [
    { key: 'Ctrl + F', description: 'Focus search bar' },
    { key: 'Ctrl + Enter', description: 'Open checkout (when cart has items)' },
    { key: 'Ctrl + Delete', description: 'Clear entire cart' },
    { key: 'Escape', description: 'Close modals/dialogs' },
    { key: 'F11', description: 'Toggle fullscreen mode' },
    { key: 'Ctrl + ?', description: 'Show this help dialog' },
    { key: 'Tab', description: 'Navigate between elements' },
    { key: 'Enter', description: 'Activate focused button/element' },
    { key: '+ / -', description: 'Increase/decrease quantity in cart' },
    { key: 'Delete', description: 'Remove item from cart (when focused)' }
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="glass max-w-lg w-full rounded-xl shadow-2xl animate-bounce-in">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-900 flex items-center">
              ⌨️ Keyboard Shortcuts
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-xl font-bold"
            >
              ×
            </button>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {shortcuts.map((shortcut, index) => (
              <div
                key={index}
                className="flex justify-between items-center p-3 rounded-lg bg-white/50 hover:bg-white/70 transition-colors"
              >
                <span className="text-gray-700">{shortcut.description}</span>
                <kbd className="px-2 py-1 bg-gray-200 rounded text-sm font-mono text-gray-800 border border-gray-300">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                💡 Tip: Use these shortcuts for faster operations
              </p>
              <button
                onClick={onClose}
                className="btn-primary"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default KeyboardShortcuts
