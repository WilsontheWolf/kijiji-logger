const { parseStringPromise } = require('xml2js');
const Enmap = require('enmap');
const { urls, ntfy } = require('../config.json');

if(!ntfy) {
    console.error('No ntfy url provided in config.json');
    process.exit(1);
}

if(!urls || !urls.length) {
    console.error('No urls provided in config.json');
    process.exit(1);
}

const data = new Enmap('data');

function processItem(item, url) {
    const data = {
        title: item.title[0],
        description: `${url.desc}\n${item.description[0] || ''}`.trim(),
        link: item.link[0],
        pubDate: new Date(item['dc:date'][0]),
        guid: item.guid[0].split('/').slice(-1)[0],
        price: parseFloat(item['g-core:price']?.[0] || '0'),
        image: item.enclosure?.[0]?.$?.url,
        undesirable: false,
        hot: false,
    }

    if (data.title.toLowerCase().includes('wanted')) {
        data.undesirable = true;
    }
    if (data.price < url.undesirable[0] || data.price > url.undesirable[1]) {
        data.undesirable = true;
    }
    if (data.price <= url.hot) {
        data.hot = true;
    }

    return data;
}

function handleNewItems(items) {
    for (const item of items) {
        const oldItem = data.get(item.guid);
        if (oldItem && oldItem.price !== item.price) {
            alertItem(item, `Price Change! ${oldItem.price} -> ${item.price}`);
        }
        data.set(item.guid, item);
        if (!oldItem) {
            if (!item.undesirable)
                alertItem(item, 'New Item!');
        }
    }
    data.forEach((item, key) => {
        if (!items.find(i => i.guid === key)) {
            data.delete(key);
            if (!item.undesirable)
                alertItem(item, `Item Removed. It was up since ${item.pubDate}.`);
        }
    });
}

async function fetchData() {
    let newItems = [];
    for (const url of urls) {
        await fetch(url.url)
            .then(res => res.ok ? res : Promise.reject(res.status))
            .then(res => res.text())
            .then(body => parseStringPromise(body))
            .then(result => {
                const items = result.rss.channel[0].item;
                return items.map(item => processItem(item, url));
            })
            .then(items => { newItems = newItems.concat(items) })
            .catch(err => console.error(err));
    }
    handleNewItems(newItems);
}

function alertItem(item, context = '') {
    const headers = {
        'X-Title': `${context} ($${item.price}) ${item.title}`,
        'X-Actions': `view, Open Link, ${item.link}`
    };

    if (item.image) {
        headers['X-Attach'] = item.image;
        headers['X-Filename'] = 'item.webp';
    }

    if (item.hot) {
        headers['X-Tags'] = 'fire';
    }

    fetch(ntfy, {
        method: 'POST',
        headers,
        body: item.description,
    })
        .then(async res => res.ok ? res : Promise.reject(res.status + ' ' + res.statusText + await res.text()))
        .catch(err => console.error(err, item, context));
}

fetchData();

setInterval(fetchData, 1000 * 60 * 5);