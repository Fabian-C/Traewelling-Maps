/**
 * Interactive Script for Träwelling Maps Documentation Hub
 * Powers Live Search, Scrollspy, Clipboard Copy, and Schema Filtering
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Live Documentation Search
    const searchInput = document.getElementById('docsSearchInput');
    const sections = Array.from(document.querySelectorAll('.docs-section, .code-card, .docs-card'));

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = (e.target.value || '').toLowerCase().trim();
            if (!query) {
                sections.forEach(sec => sec.style.display = '');
                return;
            }

            sections.forEach(sec => {
                const text = sec.innerText.toLowerCase();
                if (text.includes(query)) {
                    sec.style.display = '';
                } else {
                    sec.style.display = 'none';
                }
            });
        });

        // Keyboard shortcut: '/' or 'Cmd/Ctrl + K'
        window.addEventListener('keydown', (e) => {
            if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        });
    }

    // 2. Interactive Code Block Copy with Toast
    const toast = document.getElementById('docsToast');
    const toastMsg = document.getElementById('docsToastMsg');
    let toastTimeout = null;

    function showToast(message) {
        if (!toast) return;
        if (toastMsg) toastMsg.textContent = message;
        toast.classList.add('show');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 2200);
    }

    async function copyToClipboard(text, btn) {
        let success = false;
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                success = true;
            } catch (err) {
                // Clipboard API may fail in headless/unfocused contexts
                success = false;
            }
        }

        if (!success) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                success = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (err) {
                console.warn('Fallback copy failed:', err);
                success = false;
            }
        }

        if (success || !navigator.clipboard) {
            if (btn) {
                btn.classList.add('copied');
                const origText = btn.innerHTML;
                btn.innerHTML = '✓ Copied!';
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = origText;
                }, 2000);
            }
            showToast('Copied to clipboard!');
        } else {
            showToast('Unable to copy automatically');
        }
    }

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rawSql = btn.dataset.sql || btn.closest('.code-card')?.querySelector('.code-content')?.innerText || '';
            if (rawSql) {
                copyToClipboard(rawSql.trim(), btn);
            }
        });
    });

    // 3. Schema Table Live Filter
    const schemaSearch = document.getElementById('schemaSearchInput');
    const schemaRows = Array.from(document.querySelectorAll('#schemaTableBody tr'));

    if (schemaSearch) {
        schemaSearch.addEventListener('input', (e) => {
            const q = (e.target.value || '').toLowerCase().trim();
            schemaRows.forEach(row => {
                const rowText = row.innerText.toLowerCase();
                row.style.display = (!q || rowText.includes(q)) ? '' : 'none';
            });
        });
    }

    // 4. Scrollspy (IntersectionObserver)
    const tocLinks = Array.from(document.querySelectorAll('.docs-toc-item a, .docs-sidebar-link'));
    const sectionHeadings = Array.from(document.querySelectorAll('.docs-section[id]'));

    if ('IntersectionObserver' in window && sectionHeadings.length > 0) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.id;
                    tocLinks.forEach(link => {
                        const href = link.getAttribute('href');
                        if (href === `#${id}`) {
                            link.classList.add('active');
                        } else if (href && href.startsWith('#')) {
                            link.classList.remove('active');
                        }
                    });
                }
            });
        }, {
            rootMargin: '-80px 0px -60% 0px',
            threshold: 0
        });

        sectionHeadings.forEach(heading => observer.observe(heading));
    }

    // 5. Mobile Drawer Toggle
    const mobileToggle = document.getElementById('mobileNavToggle');
    const sidebar = document.getElementById('docsSidebar');

    if (mobileToggle && sidebar) {
        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            const isOpen = sidebar.classList.contains('open');
            mobileToggle.setAttribute('aria-expanded', String(isOpen));
        });

        // Close sidebar on link click
        sidebar.querySelectorAll('.docs-sidebar-link').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 900) {
                    sidebar.classList.remove('open');
                    mobileToggle.setAttribute('aria-expanded', 'false');
                }
            });
        });
    }
});
