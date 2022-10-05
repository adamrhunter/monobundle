#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const detectIndent = require('detect-indent');
const detectNewline = require('detect-newline');
const findRoot = require('find-root');
const flatten = require('lodash.flattendeep');
const glob = require('glob');
const ultraRunner = require('ultra-runner/lib/cli');

const DETECT_TRAILING_WHITESPACE = /\s+$/;

const jsonFiles = new Map();

class JSONFile {
    static for(path) {
        if (jsonFiles.has(path)) {
            return jsonFiles.get(path);
        }

        let jsonFile = new this(path);
        jsonFiles.set(path, jsonFile);

        return jsonFile;
    }

    constructor(filename) {
        this.filename = filename;
        this.reload();
    }

    reload() {
        let contents = fs.readFileSync(this.filename, { encoding: 'utf8' });

        this.pkg = JSON.parse(contents);
        this.lineEndings = detectNewline(contents);
        this.indent = detectIndent(contents).amount;

        let trailingWhitespace = DETECT_TRAILING_WHITESPACE.exec(contents);
        this.trailingWhitespace = trailingWhitespace ? trailingWhitespace : '';
    }

    write() {
        let contents = JSON.stringify(this.pkg, null, this.indent).replace(/\n/g, this.lineEndings);

        fs.writeFileSync(this.filename, contents + this.trailingWhitespace, { encoding: 'utf8' });
    }
}

function getPackages(packageJson) {
    if (!('workspaces' in packageJson)) {
        return null;
    }
    const {workspaces} = packageJson;
    if (Array.isArray(workspaces)) {
        return workspaces;
    }
    return workspaces.packages || null;
}

function getWorkspaces(from) {
    const root = findRoot(from, dir => {
        const pkg = path.join(dir, 'package.json');
        return fs.existsSync(pkg) && getPackages(require(pkg)) !== null;
    });

    const packages = getPackages(require(path.join(root, 'package.json')));
    return flatten(packages.map(name => glob.sync(path.join(root, `${name}/`))));
};

(async () => {
    const cwd = process.cwd();
    const nearestPkgJson = findRoot(cwd);
    console.log(nearestPkgJson);
    let pkgInfo = JSONFile.for(path.join(nearestPkgJson, 'package.json'));

    if (pkgInfo.pkg.name !== 'ghost') {
        pkgInfo = JSONFile.for(path.join(nearestPkgJson, 'ghost/core/package.json'));
    }

    const ghostVersion = pkgInfo.pkg.version;
    const workspaces = getWorkspaces(cwd).filter(w => !w.startsWith(cwd));
    const bundlePath = './components';

    if (!fs.existsSync(bundlePath)){
        fs.mkdirSync(bundlePath);
    }

    for (const w of workspaces) {
        const workspacePkgInfo = JSONFile.for(path.join(w, 'package.json'));

        if (!workspacePkgInfo.pkg.name.startsWith('@')) {
            continue;
        }

        workspacePkgInfo.pkg.version = ghostVersion;
        workspacePkgInfo.write();

        const slugifiedName = workspacePkgInfo.pkg.name.replace(/@/g, '').replace(/\//g, '-');
        const packedFilename = `file:` + path.join(bundlePath, `${slugifiedName}-${workspacePkgInfo.pkg.version}.tgz`);

        if (pkgInfo.pkg.dependencies[workspacePkgInfo.pkg.name]) {
            console.log(`setting dependencies override for ${workspacePkgInfo.pkg.name} to ${packedFilename}`);
            pkgInfo.pkg.dependencies[workspacePkgInfo.pkg.name] = packedFilename;
        }

        if (pkgInfo.pkg.optionalDependencies[workspacePkgInfo.pkg.name]) {
            console.log(`setting optionalDependencies override for ${workspacePkgInfo.pkg.name} to ${packedFilename}`);
            pkgInfo.pkg.optionalDependencies[workspacePkgInfo.pkg.name] = packedFilename;
        }

        console.log(`setting resolution override for ${workspacePkgInfo.pkg.name} to ${packedFilename}`);
        pkgInfo.pkg.resolutions[workspacePkgInfo.pkg.name] = packedFilename;
    }

    pkgInfo.write();

    console.log('\n\n');

    for (const w of workspaces) {
        console.log(`packaging ${w}`);
        const workspacePkgInfo = JSONFile.for(path.join(w, 'package.json'));

        if (!workspacePkgInfo.pkg.name.startsWith('@')) {
            continue;
        }

        if (!workspacePkgInfo.pkg.private) {
            continue;
        }

        await ultraRunner.run(['' /* placeholder */, '' /* placeholder */, '--filter', workspacePkgInfo.pkg.name, '-r', 'npm', 'pack', '--pack-destination', '../core/components']);
    }

    fs.copyFileSync('../../README.md', 'README.md');
    fs.copyFileSync('../../LICENSE', 'LICENSE');
    fs.copyFileSync('../../PRIVACY.md', 'PRIVACY.md');
    fs.copyFileSync('../../yarn.lock', 'yarn.lock');
})();
