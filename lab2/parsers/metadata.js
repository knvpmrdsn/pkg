async function parse(file)
{
    const size = file.size;
    let bytesRead = 0;

    async function read(p, n)
    {
        if (p < 0 || n < 0 || p + n > size)
        {
            throw Error('Недостаточно данных');
        }

        bytesRead += n;

        return new DataView(
            await file.slice(p, p + n).arrayBuffer()
        );
    }

    const h = await read(0, Math.min(size, 128));

    const u = p => h.getUint8(p);
    const l = p => h.getUint16(p, true);
    const L = p => h.getUint32(p, true);
    const b = p => h.getUint16(p);
    const B = p => h.getUint32(p);

    const str = (d, p, n) =>
        String.fromCharCode(
            ...Array.from({ length: n }, (_, i) => d.getUint8(p + i))
        );

    let r = {
        format: '',
        width: 0,
        height: 0,
        depth: 0,
        dpiX: null,
        dpiY: null,
        compression: '',
        extra: ''
    };

    const dpi = (x, y) =>
    {
        r.dpiX = x || null;
        r.dpiY = y || null;
    };

    const assert = (x, m = 'Некорректный заголовок') =>
    {
        if (!x)
        {
            throw Error(m);
        }
    };

    async function tiff(base, limit)
    {
        const a = await read(base, 8);
        const le = a.getUint16(0) === 0x4949;

        assert(le || a.getUint16(0) === 0x4d4d);

        assert(
            a.getUint16(2, le) === 42,
            'Поддерживается классический TIFF'
        );

        const off = a.getUint32(4, le);

        const count = (await read(base + off, 2))
            .getUint16(0, le);

        assert(off + 2 + count * 12 + 4 <= limit);

        const d = await read(base + off + 2, count * 12 + 4);
        const tags = {};

        for (let i = 0; i < count; i++)
        {
            let p = i * 12;
            let t = d.getUint16(p, le);
            let type = d.getUint16(p + 2, le);
            let n = d.getUint32(p + 4, le);

            let s = ({
                1: 1,
                3: 2,
                4: 4,
                5: 8
            })[type];

            if (
                !s ||
                !n ||
                ![
                    256, 257, 258, 259,
                    273, 277, 279, 282,
                    283, 296, 324, 325
                ].includes(t)
            )
            {
                continue;
            }

            let len = n * s;

            assert(len <= limit);

            let v;
            let o = 0;

            if (len <= 4)
            {
                v = d;
                o = p + 8;
            }
            else
            {
                let q = d.getUint32(p + 8, le);

                assert(q + len <= limit);

                v = await read(base + q, len);
            }

            tags[t] = Array.from({ length: n }, (_, j) =>
            {
                let k = o + j * s;

                return type === 1
                    ? v.getUint8(k)
                    : type === 3
                        ? v.getUint16(k, le)
                        : type === 4
                            ? v.getUint32(k, le)
                            : v.getUint32(k, le) /
                              v.getUint32(k + 4, le);
            });
        }

        return tags;
    }

    // BMP

    if (size >= 26 && str(h, 0, 2) === 'BM')
    {
        r.format = 'BMP';

        let dib = L(14);

        assert(L(2) <= size && L(10) <= size);

        if (dib === 12)
        {
            r.width = l(18);
            r.height = l(20);
            r.depth = l(24);
            r.compression = 'BI_RGB';
        }
        else
        {
            assert(dib >= 40 && size >= 14 + dib);

            r.width = h.getInt32(18, true);
            r.height = Math.abs(h.getInt32(22, true));
            r.depth = l(28);

            let c = L(30);

            r.compression = ({
                0: 'BI_RGB',
                1: 'BI_RLE8',
                2: 'BI_RLE4',
                3: 'BI_BITFIELDS',
                4: 'BI_JPEG',
                5: 'BI_PNG',
                6: 'BI_ALPHABITFIELDS'
            })[c] || `Код ${c}`;

            dpi(
                L(38) * 0.0254,
                L(42) * 0.0254
            );

            if (c === 0 || c === 3)
            {
                assert(
                    L(10) +
                    Math.ceil(r.width * r.depth / 32) *
                    4 * r.height <= size,
                    'Обрезанные пиксели'
                );
            }
            else if (L(34))
            {
                assert(L(10) + L(34) <= size);
            }

            r.extra = `Цветов палитры: ${
                L(46) || (r.depth <= 8 ? 2 ** r.depth : 0)
            }`;
        }
    }

    // PNG

    else if (
        size >= 33 &&
        B(0) === 0x89504e47 &&
        B(4) === 0x0d0a1a0a
    )
    {
        r.format = 'PNG';

        assert(
            B(8) === 13 &&
            str(h, 12, 4) === 'IHDR'
        );

        r.width = B(16);
        r.height = B(20);

        let channels = ({
            0: 1,
            2: 3,
            3: 1,
            4: 2,
            6: 4
        })[u(25)];

        assert(channels);

        r.depth = u(24) * channels;
        r.compression = 'Deflate';

        r.extra = `Фильтр: ${u(27)}; тип цвета: ${u(25)}`;

        let p = 8;
        let end = false;

        while (p + 12 <= size)
        {
            let d = await read(p, 8);
            let n = d.getUint32(0);
            let t = str(d, 4, 4);

            assert(p + 12 + n <= size);

            if (t === 'pHYs' && n === 9)
            {
                let z = await read(p + 8, 9);

                if (z.getUint8(8) === 1)
                {
                    dpi(
                        z.getUint32(0) * 0.0254,
                        z.getUint32(4) * 0.0254
                    );
                }
            }

            if (t === 'IEND')
            {
                assert(n === 0);

                end = true;
                break;
            }

            p += 12 + n;
        }

        assert(end, 'Нет IEND');
    }

    // GIF

    else if (
        size >= 13 &&
        ['GIF87a', 'GIF89a'].includes(str(h, 0, 6))
    )
    {
        r.format = 'GIF';

        r.width = l(6);
        r.height = l(8);
        r.depth = (u(10) & 7) + 1;

        r.compression = 'LZW';

        r.extra = `Глобальная палитра: ${
            u(10) & 128 ? 2 ** r.depth : 0
        }`;

        assert(
            (await read(size - 1, 1)).getUint8(0) === 59,
            'Нет трейлера GIF'
        );
    }

    // JPEG

    else if (size >= 4 && b(0) === 0xffd8)
    {
        r.format = 'JPEG';
        r.compression = 'JPEG / DCT';

        assert(
            (await read(size - 2, 2)).getUint16(0) === 0xffd9,
            'Нет EOI'
        );

        let p = 2;

        while (p < size - 2)
        {
            let m = await read(p, 2);

            assert(m.getUint8(0) === 255);

            let c = m.getUint8(1);

            if (c === 255)
            {
                p++;
                continue;
            }

            if (c === 0xda || c === 0xd9)
            {
                break;
            }

            if (c === 1 || (c >= 0xd0 && c <= 0xd7))
            {
                p += 2;
                continue;
            }

            let n = (await read(p + 2, 2)).getUint16(0);

            assert(n >= 2 && p + 2 + n <= size);

            if (
                [
                    0xc0, 0xc1, 0xc2, 0xc3,
                    0xc5, 0xc6, 0xc7, 0xc9,
                    0xca, 0xcb, 0xcd, 0xce,
                    0xcf
                ].includes(c)
            )
            {
                let d = await read(p + 4, 6);

                r.height = d.getUint16(1);
                r.width = d.getUint16(3);
                r.depth = d.getUint8(0) * d.getUint8(5);

                r.extra = `Режим: ${
                    c === 0xc0
                        ? 'Базовый последовательный JPEG'
                        : c === 0xc2
                            ? 'Прогрессивный JPEG'
                            : c === 0xc3
                                ? 'JPEG без потерь'
                                : 'Расширенный режим JPEG'
                }; компонент: ${d.getUint8(5)}; бит на компонент: ${d.getUint8(0)}`;
            }

            if (c === 0xe0 && n >= 16)
            {
                let d = await read(p + 4, 14);

                if (str(d, 0, 5) === 'JFIF\0')
                {
                    let k = d.getUint8(7);

                    if (k === 1 || k === 2)
                    {
                        dpi(
                            d.getUint16(8) * (k === 2 ? 2.54 : 1),
                            d.getUint16(10) * (k === 2 ? 2.54 : 1)
                        );
                    }
                }
            }

            if (c === 0xe1 && n >= 16)
            {
                let d = await read(p + 4, 6);

                if (str(d, 0, 6) === 'Exif\0\0')
                {
                    try
                    {
                        let t = await tiff(p + 10, n - 8);

                        let k = t[296]?.[0] === 3 ? 2.54 : 1;

                        if (
                            t[282] &&
                            t[283] &&
                            t[296]?.[0] !== 1
                        )
                        {
                            dpi(
                                t[282][0] * k,
                                t[283][0] * k
                            );
                        }
                    }
                    catch
                    {
                    }
                }
            }

            p += 2 + n;
        }
    }

    // TIFF

    else if (
        size >= 8 &&
        [0x4949, 0x4d4d].includes(b(0))
    )
    {
        r.format = 'TIFF';

        let t = await tiff(0, size);

        r.width = t[256]?.[0];
        r.height = t[257]?.[0];

        let bits = t[258] || [1];

        r.depth = bits.length === 1
            ? bits[0] * (t[277]?.[0] || 1)
            : bits.reduce((a, b) => a + b, 0);

        let c = t[259]?.[0] || 1;

        r.compression = ({
            1: 'Без сжатия',
            2: 'CCITT RLE',
            3: 'CCITT Group 3',
            4: 'CCITT Group 4',
            5: 'LZW',
            6: 'Old JPEG',
            7: 'JPEG',
            8: 'Deflate',
            32773: 'PackBits',
            32946: 'Deflate'
        })[c] || `Код ${c}`;

        let unit = t[296]?.[0] ?? 2;

        if (unit !== 1)
        {
            dpi(
                t[282]?.[0] * (unit === 3 ? 2.54 : 1),
                t[283]?.[0] * (unit === 3 ? 2.54 : 1)
            );
        }

        for (let [a, b] of [[273, 279], [324, 325]])
        {
            if (t[a] && t[b])
            {
                assert(t[a].length === t[b].length);

                t[a].forEach((x, i) =>
                {
                    assert(
                        x + t[b][i] <= size,
                        'Обрезанные блоки TIFF'
                    );
                });
            }
        }

        r.extra = 'IFD: ' +
            Object.keys(t).length +
            ' считанных тегов';
    }

    // PCX

    else if (
        size >= 128 &&
        u(0) === 10 &&
        [0, 1].includes(u(2)) &&
        [1, 2, 4, 8].includes(u(3))
    )
    {
        r.format = 'PCX';

        r.width = l(8) - l(4) + 1;
        r.height = l(10) - l(6) + 1;
        r.depth = u(3) * u(65);

        dpi(l(12), l(14));

        r.compression = u(2)
            ? 'RLE'
            : 'Без сжатия';

        assert(
            l(66) > 0 &&
            u(65) > 0 &&
            size > 128
        );

        r.extra = `Плоскостей: ${u(65)}`;
    }

    // Неизвестный формат

    else
    {
        throw Error('Неизвестная сигнатура или поврежденный файл');
    }

    assert(
        r.width > 0 &&
        r.height > 0 &&
        r.depth > 0
    );

    return {
        ...r,
        bytesRead
    };
}