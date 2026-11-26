const workerURL = URL.createObjectURL(
    new Blob([METADATA_SOURCE, "\n", WORKER_SOURCE], {
        type: "text/javascript"
    })
);

function scan(files, onBatch, onDone)
{
    let next = 0;
    let done = 0;
    let batch = [];
    let closed = false;
    let paused = false;
    let activeStart = performance.now();
    let elapsed = 0;

    const workers = [];
    const idle = new Set();
    const pending = new Map();

    function flush()
    {
        if (batch.length)
        {
            const out = batch;
            batch = [];

            onBatch(out, done, files.length);
        }
    }

    function time()
    {
        return elapsed + (paused ? 0 : performance.now() - activeStart);
    }

    const timer = setInterval(flush, 100);

    function stop()
    {
        if (closed)
        {
            return;
        }

        const ms = time();

        closed = true;

        clearInterval(timer);
        workers.forEach(w => w.terminate());

        flush();
        onDone(done, ms);
    }

    function send(w)
    {
        if (closed)
        {
            return;
        }

        if (paused || next >= files.length)
        {
            idle.add(w);
            return;
        }

        idle.delete(w);

        const id = next++;

        pending.set(w, id);

        w.postMessage({
            id,
            file: files[id]
        });
    }

    function complete(w, data)
    {
        if (closed)
        {
            return;
        }

        pending.delete(w);

        done++;
        batch.push(data);

        if (done === files.length)
        {
            stop();
            return;
        }

        send(w);

        if (paused)
        {
            flush();
        }
    }

    const workerCount = Math.min(
        files.length,
        Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4))
    );

    for (let i = 0; i < workerCount; i++)
    {
        const w = new Worker(workerURL);

        workers.push(w);

        w.onmessage = ({ data }) =>
        {
            complete(w, data);
        };

        w.onerror = e =>
        {
            e.preventDefault?.();
            stop();
        };

        send(w);
    }

    stop.pause = () =>
    {
        if (closed || paused)
        {
            return;
        }

        elapsed += performance.now() - activeStart;
        paused = true;

        flush();
    };

    stop.resume = () =>
    {
        if (closed || !paused)
        {
            return;
        }

        paused = false;
        activeStart = performance.now();

        for (const w of [...idle])
        {
            send(w);
        }
    };

    stop.time = time;

    return stop;
}