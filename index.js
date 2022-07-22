#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const detectIndent = require('detect-indent');
const detectNewline = require('detect-newline');
const findRoot = require('find-root');
const flatten = require('flatten');
const glob = require('glob');

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
    const workspaces = getWorkspaces(cwd);
    const pkgInfo = JSONFile.for(path.join(cwd, 'package.json'));

    for (const w of workspaces) {
        const workspacePkgInfo = JSONFile.for(path.join(w, 'package.json'));
        const slugifiedName = workspacePkgInfo.pkg.name.replace(/@/g, '').replace(/\//g, '-');
        const packedFilename = path.join('./components', `${slugifiedName}-${workspacePkgInfo.pkg.version}.tgz`);

        console.log(`  setting resolution for ${workspacePkgInfo.pkg.name} to ${packedFilename}`);
        pkgInfo.pkg.resolutions[workspacePkgInfo.pkg.name] = `file:${packedFilename}`;
    }

    pkgInfo.write();
})();
