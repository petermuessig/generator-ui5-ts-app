"use strict";
const Generator = require("yeoman-generator");
// patches the Generator for the install tasks as new custom install
// tasks produce ugly errors! (Related issue: https://github.com/yeoman/environment/issues/309)
require('lodash').extend(Generator.prototype, require('yeoman-generator/lib/actions/install'))

const chalk = require("chalk");
const yosay = require("yosay");
const path = require("path");
const glob = require("glob");
const semver = require("semver");
const packageJson = require('package-json');

const {isValidUrl, ODataMetadata} = require("./utils");

module.exports = class extends Generator {

  static displayName = "Create a new UI5 TypeScript application";

  constructor(args, opts) {
    super(args, opts, {
      // disable the Yeoman 5 package-manager logic (auto install)!
      customInstallTask: "disabled"
    });
  }

  async prompting() {

    // Have Yeoman greet the user.
    if (!this.options.embedded) {
      this.log(
        yosay(`Welcome to the ${chalk.red("generator-ui5-ts-app")} generator!`)
      );
    }

    const minTSFwkVersion = {
      OpenUI5: "1.90.1", //"1.60.0",
      SAPUI5: "1.90.0" //"1.77.0"
    };

    const minWCFwkVersion = {
      OpenUI5: "1.92.0",
      SAPUI5: "1.104.0"
    };

    const fwkDependencies = {
      OpenUI5: "@openui5/ts-types-esm",
      SAPUI5: "@sapui5/ts-types-esm"
    };

    const questions = [
      {
        type: "input",
        name: "application",
        message: "How do you want to name this application?",
        validate: s => {
          if (/^\d*[a-zA-Z][a-zA-Z0-9]*$/g.test(s)) {
            return true;
          }

          return "Please use alpha numeric characters only for the application name.";
        },
        default: "myapp"
      },
      {
        type: "input",
        name: "namespace",
        message: "Which namespace do you want to use?",
        validate: s => {
          if (/^[a-zA-Z0-9_.]*$/g.test(s)) {
            return true;
          }

          return "Please use alpha numeric characters and dots only for the namespace.";
        },
        default: "com.myorg"
      },
      {
        type: "input",
        name: "title",
        message: "Which title do you want to use?",
        default: "UI5con HYBRID 2022"
      },
      {
        type: "list",
        name: "framework",
        message: "Which framework do you want to use?",
        choices: ["OpenUI5", "SAPUI5"],
        default: "OpenUI5"
      },
      {
        when: response => {
          this._minTSFwkVersion = minTSFwkVersion[response.framework];
          return true;
        },
        type: "input", // HINT: we could also use the version info from OpenUI5/SAPUI5 to provide a selection!
        name: "frameworkVersion",
        message: "Which framework version do you want to use?",
        default: async (answers) => {
          const npmPackage = fwkDependencies[answers.framework];
          try {
            return (await packageJson(npmPackage)).version;
          } catch (ex) {
            chalk.red('Failed to lookup latest version for ${npmPackage}! Fallback to min version...')
            return minTSFwkVersion[answers.framework];
          }
        },
        validate: v => {
          return (
            (v && semver.valid(v) && semver.gte(v, this._minTSFwkVersion)) ||
            chalk.red(
              `Framework requires the min version ${this._minTSFwkVersion} due to the availability of the ts-types!`
            )
          );
        }
      },
      {
        when: response => {
          const v = this._minWCFwkVersion = minWCFwkVersion[response.framework];
          return v && semver.valid(v) && semver.gte(response.frameworkVersion, v);
        },
        type: "confirm",
        name: "useWebComponents",
        message: "Do you want to use UI5 Web Components?",
        default: false
      },
      {
        type: "confirm",
        name: "useDataSource",
        message: "Do you want to connect to an OData service?",
        default: true
      },
      {
        when: response => response.useDataSource,
        type: "input",
        name: "endpoint",
        message: "Which endpoint do you want to use for your OData service?",
        validate: async (url) => {
          if (isValidUrl(url, ['http', 'https'])) {
            try {
              this._metadata = await ODataMetadata.load(url);
              return !!this._metadata;
            } catch (err) {
              return `Please provide a valid OData service endpoint.\n${err.message}`;
            }
          }
          return "Please provide a valid OData service endpoint.";
        },
        default: "http://localhost:4004/ui5con2022/"
      },
      {
        when: response => response.useDataSource,
        type: "list",
        name: "entity",
        message: "Which entity do you want to start from?",
        choices: answers => {
          return this._metadata.getEntitySets();
        }
      },
      {
        when: response => response.useDataSource,
        type: "list",
        name: "key",
        message: "Which property do you want to use as key?",
        choices: answers => {
          this._entity = answers.entity;
          return this._metadata.getKeys(this._entity);
        }
      },
      {
        type: "checkbox",
        name: "properties",
        message: "Which properties do you want to display?",
        choices: answers => {
          return this._metadata.getProperties(this._entity);
        }
      },
      {
        type: "input",
        name: "author",
        message: "Who is the author of the application?",
        default: this.user.git.name()
      },
      {
        type: "confirm",
        name: "newdir",
        message: "Would you like to create a new directory for the application?",
        default: true
      }
    ];

    const props = await this.prompt(questions);

    // use the namespace and the application name as new directory
    if (props.newdir) {
      this.destinationRoot(`${props.namespace}.${props.application}`);
    }
    delete props.newdir;

    // apply the properties
    this.config.set(props);

    // determine the ts-types and version
    this.config.set("tstypes", `@${props.framework.toLowerCase()}/ts-types-esm`);
    this.config.set("tstypesVersion", props.frameworkVersion);

    // appId + appURI
    this.config.set("appId", `${props.namespace}.${props.application}`);
    this.config.set("appURI", `${props.namespace.split(".").join("/")}/${props.application}`);

  }

  writing() {
    const oConfig = this.config.getAll();

    this.sourceRoot(path.join(__dirname, "templates"));
    glob
      .sync("**", {
        cwd: this.sourceRoot(),
        nodir: true
      })
      .forEach(file => {
        const sOrigin = this.templatePath(file);
        let sTarget = this.destinationPath(
          file
            .replace(/^_/, "")
            .replace(/\/_/, "/")
        );

        this.fs.copyTpl(sOrigin, sTarget, oConfig);
      });
  }

  install() {
    this.config.set("setupCompleted", true);
    // needed as long as the Yeoman 5.x installer produces
    // ugly error messages while looking for package.json
    this.installDependencies({
      bower: false,
      npm: true
    });
  }

  end() {
    this.spawnCommandSync("git", ["init", "--quiet"], {
      cwd: this.destinationPath()
    });
    this.spawnCommandSync("git", ["add", "."], {
      cwd: this.destinationPath()
    });
    this.spawnCommandSync(
      "git",
      [
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "Initial commit"
      ],
      {
        cwd: this.destinationPath()
      }
    );
  }
};