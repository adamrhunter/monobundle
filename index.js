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
    const packageJson = JSONFile.for(path.join(cwd, 'package.json'));

    const workspaces = getWorkspaces(cwd);

    const packages = workspaces.map(w => {
        const workspacePackageJson = require(path.join(w, 'package.json'));

        return {
            path: w,
            name: workspacePackageJson.name,
            version: workspacePackageJson.version
        };
    }).filter(p => p.name !== packageJson.name);

    function replaceDependencies(dependencyType) {
        const dependencies = packageJson.pkg[dependencyType];

        if (!dependencies) return;

        for (const p in dependencies) {
            const linkedPackage = packages.find(wp => wp.name === p);
            if (!linkedPackage) continue;

            const slugifiedName = p.replace(/@/g, '').replace(/\//g, '-');
            const packedFilename = `${slugifiedName}-${linkedPackage.version}.tgz`;

            console.log(`rewriting ${p} from ${dependencies[p]} to ${packedFilename}`);
            dependencies[p] = `file:./components/${packedFilename}`;
        }
    }

    replaceDependencies('dependencies');
    replaceDependencies('optionalDependencies');

    packageJson.write();
})();
