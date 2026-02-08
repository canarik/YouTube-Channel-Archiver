document.addEventListener('DOMContentLoaded', () => {
    const xlsxCheckbox = document.getElementById('xlsx-checkbox');

    // Load state
    chrome.storage.local.get(['exportXlsx'], (result) => {
        // Default to false (user choice)
        if (result.exportXlsx === undefined) {
            xlsxCheckbox.checked = false;
            chrome.storage.local.set({ exportXlsx: false });
        } else {
            xlsxCheckbox.checked = result.exportXlsx;
        }
    });

    // Save state
    xlsxCheckbox.addEventListener('change', () => {
        chrome.storage.local.set({ exportXlsx: xlsxCheckbox.checked });
    });
});
