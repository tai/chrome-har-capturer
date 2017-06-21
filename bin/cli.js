#!/usr/bin/env node
'use strict';

const chalk = require('chalk');
const program = require('commander');

const CHC = require('..');

// See https://chromium.googlesource.com/experimental/chromium/src/+/refs/wip/bajones/webvr/chrome/test/chromedriver/chrome/mobile_device_list.cc
const agentTable = {
    nexus6p: {
        ua: 'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Mobile Safari/537.36',
        metrics: {
            mobile: true,
            width: 412,
            height: 732,
            deviceScaleFactor: 3.5,
            fontScaleFactor: 1.0,
            emulateViewport: true,
            textAutosizing: true,
            fitWindow: true
        }
    },

    iphone6p: {
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4',
        metrics: {
            mobile: true,
            width: 414,
            height: 736,
            deviceScaleFactor: 3.0,
            fontScaleFactor: 1.0,
            emulateViewport: true,
            textAutosizing: true,
            fitWindow: true
        }
    }
};

let collect = (arg, memo) => {
   memo.push(arg); return memo;
};

program
    .usage('[options] URL...')
    .option('-t, --host <host>', 'Chrome Debugging Protocol host')
    .option('-p, --port <port>', 'Chrome Debugging Protocol port')
    .option('-x, --width <dip>', 'frame width in DIP')
    .option('-y, --height <dip>', 'frame height in DIP')
    .option('-o, --output <file>', 'write to file instead of stdout')
    .option('-c, --content', 'also capture the requests body')
    .option('-a, --agent <agent>', 'user agent override')
    .option('-g, --grace <ms>', 'time to wait after the load event')
    .option('-u, --timeout <ms>', 'time to wait before giving up with a URL')
    .option('-l, --parallel <n>', 'load <n> URLs in parallel')
    .option('-h, --header [header]', 'Add request header', collect, [])
    .parse(process.argv);

if (program.args.length === 0) {
    program.outputHelp();
    process.exit(1);
}

function prettify(url) {
    try {
        const {parse, format} = require('url');
        const urlObject = parse(url);
        urlObject.protocol = chalk.gray(urlObject.protocol.slice(0, -1));
        urlObject.host = chalk.bold(urlObject.host);
        return format(urlObject).replace(/[:/?=#]/g, chalk.gray('$&'));
    } catch (err) {
        // invalid URL delegate error detection
        return url;
    }
}

function log(string) {
    process.stderr.write(string);
}

async function preHook(url, client) {
    const {Page, Network} = client;

    Page.enable();
    Network.enable();

    // optionally set user agent
    const userAgent = program.agent;
    if (typeof userAgent === 'string') {
        await Network.setUserAgentOverride({userAgent});
    }

    // set user-defined headers
    if (program.header) {
        let userHeader = {};

        for (let i = 0; i < program.header.length; i++) {
            let kv = program.header[i];
            let isep = kv.indexOf(':');
            if (isep > 0) {
                let key = kv.substr(0, isep);
                let val = kv.substr(isep + 1);
                userHeader[key] = val;
            }
        }

        Network.requestWillBeSent((params) => {
            params.request.headers = Object.assign(params.request.headers, userHeader);
        });
    }

    // Enable mobile emulation
    // See https://src.chromium.org/viewvc/blink/trunk/Source/devtools/protocol.json?revision=202619#l637
    let agentInfo = agentTable[userAgent];
    if (agentInfo) {
        await Network.setUserAgentOverride({ userAgent: agentInfo.ua });
        await Page.setDeviceMetricsOverride(agentInfo.metrics);
    }
}

function postHook(url, client) {
    return new Promise((fulfill, reject) => {
        // allow the user specified grace time
        setTimeout(fulfill, program.grace || 0);
    });
}

const {host, port, width, height, content, timeout, parallel} = program;
CHC.run(program.args, {
    host, port,
    width, height,
    content,
    timeout,
    parallel,
    preHook, postHook
}).on('load', (url) => {
    log(`- ${prettify(url)} `);
    if (parallel) {
        log(chalk.yellow('…\n'));
    }
}).on('done', (url) => {
    if (parallel) {
        log(`- ${prettify(url)} `);
    }
    log(chalk.green('✓\n'));
}).on('fail', (url, err) => {
    if (parallel) {
        log(`- ${prettify(url)} `);
    }
    log(chalk.red(`✗\n  ${err.message}\n`));
}).on('har', (har) => {
    const fs = require('fs');
    const json = JSON.stringify(har, null, 4);
    const output = program.output
          ? fs.createWriteStream(program.output)
          : process.stdout;
    output.write(json);
    output.write('\n');
});
