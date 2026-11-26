self.onmessage = async ({ data: { id, file } }) =>
{
    try
    {
        self.postMessage({
            id,
            ...await parse(file),
            status: 'OK'
        });
    }
    catch (e)
    {
        let format = '';

        try
        {
            const a = new Uint8Array(
                await file.slice(0, 8).arrayBuffer()
            );

            const starts = (...v) => v.every((x, i) => a[i] === x);

            if (starts(255, 216))
            {
                format = 'JPEG';
            }
            else if (starts(66, 77))
            {
                format = 'BMP';
            }
            else if (starts(137, 80, 78, 71, 13, 10, 26, 10))
            {
                format = 'PNG';
            }
            else if (
                starts(71, 73, 70, 56, 55, 97) ||
                starts(71, 73, 70, 56, 57, 97)
            )
            {
                format = 'GIF';
            }
            else if (
                starts(73, 73, 42, 0) ||
                starts(77, 77, 0, 42) ||
                starts(73, 73, 43, 0) ||
                starts(77, 77, 0, 43)
            )
            {
                format = 'TIFF';
            }
            else if (
                a[0] === 10 &&
                [0, 1].includes(a[2]) &&
                [1, 2, 4, 8].includes(a[3])
            )
            {
                format = 'PCX';
            }
        }
        catch
        {
        }

        self.postMessage({
            id,
            format,
            status: 'Файл поврежден / не поддерживается',
            extra: e.message
        });
    }
};