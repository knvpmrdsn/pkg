const $ = id => document.getElementById(id);

let files = [],
    results = [],
    filtered = [],
    page = 0,
    cancel = null,
    errors = 0,
    dirty = true,
    sortCol = -1,
    sortDir = 0,
    paused = false;

const limit = 100;

const supportedFormats = new Set([
    "JPEG", "GIF", "TIFF", "BMP", "PNG", "PCX"
]);

let previewURL = null;

const headers = [...document.querySelectorAll('thead th')];
const headerNames = headers.map(h => h.textContent);
const collator = new Intl.Collator('ru', { sensitivity: 'base' });

const keys = [
    r => files[r.id].name,
    r => r.format || null,
    r => r.width && r.height ? r.width * r.height : null,
    r => r.dpiX ?? null,
    r => r.depth ?? null,
    r => r.compression || null,
    r => r.status
];

function compare(a, b)
{
    let x = keys[sortCol](a);
    let y = keys[sortCol](b);

    if (x == null || y == null)
    {
        return x == null && y == null
            ? a.id - b.id
            : x == null ? 1 : -1;
    }

    let c = typeof x === 'number'
        ? x - y
        : collator.compare(x, y);

    if (!c && sortCol === 3)
    {
        c = (a.dpiY ?? 0) - (b.dpiY ?? 0);
    }

    return c * sortDir || a.id - b.id;
}

function resetScroll()
{
    document.querySelector('.scroll').scrollTop = 0;
}

function gotoPage(n)
{
    page = n;
    render();
    resetScroll();
}

function pagination(pages)
{
    const el = $('pageButtons');
    el.replaceChildren();

    function add(text, n, disabled = false)
    {
        const b = document.createElement('button');

        b.textContent = text;
        b.disabled = disabled;

        if (n === page && /^\d+$/.test(text))
        {
            b.className = 'active';
            b.setAttribute('aria-current', 'page');
        }

        b.onclick = () => gotoPage(n);
        el.append(b);
    }

    add('‹', page - 1, page === 0);

    const nums = pages <= 9
        ? Array.from({ length: pages }, (_, i) => i)
        : [...new Set([
            0, 1, 2, 3, 4,
            page - 1,
            page,
            page + 1,
            pages - 1
        ].filter(n => n >= 0 && n < pages))]
            .sort((a, b) => a - b);

    let last = -1;

    for (const n of nums)
    {
        if (n - last > 1)
        {
            let e = document.createElement('span');

            e.className = 'ellipsis';
            e.textContent = '…';

            el.append(e);
        }

        add(String(n + 1), n);
        last = n;
    }

    add('›', page + 1, page >= pages - 1);
}

headers.forEach((h, i) =>
{
    h.tabIndex = 0;
    h.setAttribute('aria-sort', 'none');

    const toggle = () =>
    {
        if (sortCol !== i)
        {
            sortCol = i;
            sortDir = 1;
        }
        else if (sortDir === 1)
        {
            sortDir = -1;
        }
        else
        {
            sortCol = -1;
            sortDir = 0;
        }

        headers.forEach((t, j) =>
        {
            t.textContent = headerNames[j] +
                (sortCol === j
                    ? (sortDir === 1 ? ' ↑' : ' ↓')
                    : '');

            t.setAttribute(
                'aria-sort',
                sortCol === j
                    ? (sortDir === 1 ? 'ascending' : 'descending')
                    : 'none'
            );
        });

        dirty = true;
        page = 0;

        render();
        resetScroll();
    };

    h.onclick = toggle;

    h.onkeydown = e =>
    {
        if (e.key === 'Enter' || e.key === ' ')
        {
            e.preventDefault();
            toggle();
        }
    };
});

const volume = n =>
{
    return `${n.toLocaleString('ru-RU')} Б (${(n / 1000000)
        .toLocaleString('ru-RU', {
            maximumFractionDigits: 2
        })} МБ)`;
};

function render()
{
    if (dirty)
    {
        const q = $('search').value.toLowerCase();
        const f = $('filter').value;
        const st = $('statusFilter').value;

        filtered = results.filter(r =>
            files[r.id].name.toLowerCase().includes(q) &&
            (
                !f ||
                (
                    f === 'other'
                        ? !supportedFormats.has(r.format)
                        : r.format === f
                )
            ) &&
            (
                !st ||
                (
                    st === 'ok'
                        ? r.status === 'OK'
                        : r.status !== 'OK'
                )
            )
        );

        filtered.sort(
            sortCol < 0
                ? (a, b) => a.id - b.id
                : compare
        );

        dirty = false;
    }

    let pages = Math.max(1, Math.ceil(filtered.length / limit));

    page = Math.min(page, pages - 1);
    pagination(pages);

    let frag = document.createDocumentFragment();

    for (let r of filtered.slice(page * limit, (page + 1) * limit))
    {
        let tr = document.createElement('tr');

        let vals = [
            files[r.id].name,
            r.format || 'Другое',
            r.width ? `${r.width} × ${r.height}` : '—',
            r.dpiX
                ? `${r.dpiX.toFixed(2)} × ${r.dpiY?.toFixed(2) ?? '—'}`
                : 'Не задано',
            r.depth || '—',
            r.compression || '—',
            r.status
        ];

        vals.forEach((v, i) =>
        {
            let td = document.createElement('td');

            td.textContent = v;

            if (i === 6)
            {
                td.className = r.status === 'OK' ? 'ok' : 'bad';
            }

            tr.append(td);
        });

        tr.onclick = () => detail(r);
        tr.tabIndex = 0;

        tr.onkeydown = e =>
        {
            if (e.key === 'Enter')
            {
                detail(r);
            }
        };

        frag.append(tr);
    }

    $('rows').replaceChildren(frag);
}

function clearPreview()
{
    const img = $('preview');

    img.onload = img.onerror = null;
    img.hidden = true;
    img.removeAttribute('src');

    $('previewMessage').hidden = true;

    if (previewURL)
    {
        URL.revokeObjectURL(previewURL);
        previewURL = null;
    }
}

function detail(r)
{
    clearPreview();

    $('filename').textContent = files[r.id].name;

    const f = files[r.id];

    const props = [
        ['Имя', f.name],
        ['Размер файла', volume(f.size)],
        [
            'Расширение',
            f.name.includes('.') ? f.name.split('.').pop() : '—'
        ],
        ['Формат по сигнатуре', r.format || 'Не определён'],
        [
            'Размеры',
            r.width ? `${r.width} × ${r.height} px` : '—'
        ],
        [
            'Пикселей',
            r.width
                ? (r.width * r.height).toLocaleString('ru-RU')
                : '—'
        ],
        [
            'DPI',
            r.dpiX
                ? `${r.dpiX.toFixed(2)} × ${r.dpiY?.toFixed(2) ?? '—'}`
                : 'Не задано'
        ],
        [
            'Глубина цвета',
            r.depth ? `${r.depth} бит/пиксель` : '—'
        ],
        ['Сжатие', r.compression || '—'],
        ['Статус', r.status],
        [
            'Прочитано для анализа',
            r.bytesRead == null ? '—' : `${r.bytesRead} байт`
        ]
    ];

    $('info').replaceChildren();

    for (const [k, v] of props)
    {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');

        dt.textContent = k;
        dd.textContent = v;

        $('info').append(dt, dd);
    }

    const img = $('preview');
    const msg = $('previewMessage');

    previewURL = URL.createObjectURL(f);

    const current = previewURL;

    img.onload = () =>
    {
        if (previewURL === current)
        {
            img.hidden = false;
            msg.hidden = true;
        }
    };

    img.onerror = () =>
    {
        if (previewURL === current)
        {
            img.hidden = true;
            msg.textContent = 'Изображение недоступно для просмотра в браузере.';
            msg.hidden = false;
        }
    };

    img.src = current;

    $('detail').showModal();
}

function updateProgress(n, total)
{
    $('progress').value = n;

    $('percent').textContent =
        (total ? Math.floor(n / total * 100) : 0) + '%';
}

function stopButton(isPaused)
{
    paused = isPaused;

    $('stop').classList.toggle('paused', isPaused);

    $('stop').innerHTML = isPaused
        ? `
            <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="m8 5 12 7-12 7z"/>
            </svg>
            <span>Продолжить</span>
        `
        : `
            <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="M9 5H6v14h3zM18 5h-3v14h3z"/>
            </svg>
            <span>Остановить</span>
        `;
}

function start(list)
{
    if (!list.length)
    {
        $('status').textContent = 'Нет файлов для анализа';
        return;
    }

    if (list.length > 100000)
    {
        $('status').textContent = 'Максимум 100000 файлов';
        return;
    }

    if (cancel)
    {
        cancel();
    }

    files = Array.from(list);
    results = [];
    errors = 0;
    page = 0;
    dirty = true;

    $('total').textContent = files.length;

    $('volume').textContent = volume(
        files.reduce((sum, f) => sum + f.size, 0)
    );

    resetScroll();

    $('done').textContent = 0;
    $('errors').textContent = 0;
    $('time').textContent = '—';

    $('progress').max = files.length || 1;

    updateProgress(0, files.length);
    stopButton(false);

    $('stop').disabled = false;
    $('status').textContent = 'Анализ...';

    render();

    cancel = scan(
        files,

        (batch, n, total) =>
        {
            for (let r of batch)
            {
                results.push(r);

                if (r.status !== 'OK')
                {
                    errors++;
                }
            }

            dirty = true;

            $('done').textContent = n;
            $('errors').textContent = errors;

            updateProgress(n, total);

            if (paused)
            {
                $('status').textContent =
                    `Приостановлено: ${n} из ${total}`;
            }

            render();
        },

        (n, ms) =>
        {
            stopButton(false);

            $('stop').disabled = true;

            $('time').textContent =
                (ms / 1000).toFixed(2) + ' с';

            $('status').textContent =
                n === files.length
                    ? 'Анализ завершён'
                    : `Остановлено: ${n} из ${files.length}`;

            cancel = null;
        }
    );
}

for (let id of ['folder', 'files'])
{
    $(id).onchange = e =>
    {
        dropVersion++;
        start(e.target.files);
        e.target.value = '';
    };
}

$('stop').onclick = () =>
{
    if (!cancel)
    {
        return;
    }

    if (paused)
    {
        stopButton(false);

        $('status').textContent = 'Анализ...';

        cancel.resume();
    }
    else
    {
        stopButton(true);

        cancel.pause();

        $('time').textContent =
            (cancel.time() / 1000).toFixed(2) + ' с';

        $('status').textContent =
            `Приостановлено: ${$('done').textContent} из ${files.length}`;
    }
};

$('search').oninput =
$('filter').onchange =
$('statusFilter').onchange = () =>
{
    dirty = true;
    page = 0;

    render();
    resetScroll();
};

$('close').onclick = () => $('detail').close();

$('detail').onclose = clearPreview;

$('detail').addEventListener('click', e =>
{
    const rect = $('detail').getBoundingClientRect();

    if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
    )
    {
        $('detail').close();
    }
});

$('drop').ondragover = e =>
{
    e.preventDefault();

    $('drop').classList.add('drag');
};

$('drop').ondragleave = () =>
{
    $('drop').classList.remove('drag');
};

let dropVersion = 0;

$('drop').ondrop = async e =>
{
    e.preventDefault();

    $('drop').classList.remove('drag');

    const version = ++dropVersion;
    const fallback = Array.from(e.dataTransfer.files);

    const items = Array.from(e.dataTransfer.items || [])
        .filter(i => i.kind === 'file')
        .map(i =>
        {
            let handle = null;
            let entry = null;
            let file = null;

            try
            {
                if (i.getAsFileSystemHandle)
                {
                    handle = i.getAsFileSystemHandle()
                        .catch(() => null);
                }
            }
            catch
            {
            }

            try
            {
                entry = i.webkitGetAsEntry?.();
            }
            catch
            {
            }

            if (!entry?.isDirectory)
            {
                try
                {
                    file = i.getAsFile();
                }
                catch
                {
                }
            }

            return { handle, entry, file };
        });

    if (cancel)
    {
        cancel();
    }

    $('status').textContent = 'Чтение папок…';

    const list = [];

    function add(f)
    {
        if (list.length >= 100000)
        {
            throw Error('Максимум 100000 файлов');
        }

        list.push(f);

        if (list.length % 1000 === 0)
        {
            $('status').textContent =
                `Чтение папок… ${list.length} файлов`;
        }
    }

    async function walkHandle(h)
    {
        if (version !== dropVersion)
        {
            return;
        }

        if (h.kind === 'file')
        {
            add(await h.getFile());
        }
        else if (h.kind === 'directory')
        {
            for await (const child of h.values())
            {
                await walkHandle(child);
            }
        }
    }

    async function walkEntry(entry)
    {
        if (version !== dropVersion)
        {
            return;
        }

        if (entry.isFile)
        {
            add(
                await new Promise((resolve, reject) =>
                {
                    entry.file(resolve, reject);
                })
            );
        }
        else if (entry.isDirectory)
        {
            const reader = entry.createReader();

            while (true)
            {
                const batch = await new Promise((resolve, reject) =>
                {
                    reader.readEntries(resolve, reject);
                });

                if (!batch.length)
                {
                    break;
                }

                for (const child of batch)
                {
                    await walkEntry(child);
                }
            }
        }
    }

    try
    {
        for (const item of items)
        {
            const before = list.length;
            const h = await item.handle;

            if (h)
            {
                try
                {
                    await walkHandle(h);
                    continue;
                }
                catch (err)
                {
                    if (err.message === 'Максимум 100000 файлов')
                    {
                        throw err;
                    }

                    list.length = before;

                    if (!item.entry && !item.file)
                    {
                        throw err;
                    }
                }
            }

            if (item.entry)
            {
                try
                {
                    await walkEntry(item.entry);
                    continue;
                }
                catch (err)
                {
                    if (
                        item.entry.isDirectory ||
                        !item.file ||
                        err.message === 'Максимум 100000 файлов'
                    )
                    {
                        throw err;
                    }

                    list.length = before;
                }
            }

            if (item.file)
            {
                add(item.file);
            }
            else
            {
                throw Error('Браузер не предоставил доступ к папке');
            }
        }

        if (version === dropVersion)
        {
            start(items.length ? list : fallback);
        }
    }
    catch (err)
    {
        if (version === dropVersion)
        {
            $('status').textContent =
                'Не удалось прочитать папку: ' +
                err.message +
                '. Попробуйте кнопку «Выбрать папку».';
        }
    }
};

render();