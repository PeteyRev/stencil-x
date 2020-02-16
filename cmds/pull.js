const axios = require('axios');
const inquirer = require('inquirer');
const fs = require('fs');
const unzipper = require('unzipper');
const cliProgress = require('cli-progress');

module.exports = async function stencilPull() {
  let credentials;

  try {
    if (!fs.existsSync('./.stencil')) {
      console.log('Stencil file not found');
      process.exit();
    } else {
      await new Promise(resolve =>
        fs.readFile('./.stencil', (err, data) => {
          if (err) throw err;
          credentials = JSON.parse(data);
          resolve();
        })
      );
    }
    const config = {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        timeout: 5000,
        'x-auth-token': credentials.accessToken,
        'x-auth-client': credentials.clientId
      }
    };


    if (!credentials.store_hash) {
      const getStoreHash = await inquirer.prompt([
        {
          type: 'input',
          name: 'store_hash',
          message: 'What is the store hash'
        }
      ]);
      credentials.store_hash = getStoreHash.store_hash
      fs.writeFileSync('./.stencil', JSON.stringify(credentials))
    }

    const getThemes = await axios.get(
      `https://api.bigcommerce.com/stores/${credentials.store_hash}/v3/themes`,
      config
    );
    const themes = getThemes.data.data.map(i => {
      return {
        name: i.name,
        active: i.is_active,
        value: i.uuid
      };
    });

    const promptUser = await inquirer.prompt([
      {
        type: 'list',
        name: 'theme',
        message: 'Which theme would you like to download?',
        choices: themes
      }
    ]);

    const downloadTheme = await axios.post(
      `https://api.bigcommerce.com/stores/${credentials.store_hash}/v3/themes/${promptUser.theme}/actions/download`,
      { which: 'last_created' },
      config
    );

    const downloadBar = new cliProgress.SingleBar(
      {},
      cliProgress.Presets.shades_classic
    );

    const checkProgress = async () => {
      downloadBar.start(100, 0);
      const getThemeUrl = await axios.get(
        `https://api.bigcommerce.com/stores/${credentials.store_hash}/v3/themes/jobs/${downloadTheme.data.job_id}`,
        config
      );

      const job = getThemeUrl.data.data;
      downloadBar.update(job.percent_complete);
      if (job.status !== 'COMPLETED') {
        setTimeout(async () => {
          await checkProgress();
        }, 2500);
      } else {
        const url = getThemeUrl.data.data.result.download_url;
        const zip = await axios.get(url, { responseType: 'stream' });
        await new Promise(resolve =>
          zip.data
            .pipe(fs.createWriteStream('cornerstone.zip'))
            .on('finish', resolve)
        );
        downloadBar.stop();
        const askUserForUnzip = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'unzip',
            message: 'Would you like to unzip the theme into the current directory? Warning: this will overwrite the current directory contents'
          }
        ]);
        if (askUserForUnzip.unzip === true) {
          fs.createReadStream('cornerstone.zip').pipe(
            unzipper.Extract({ path: './' })
          );
          // fs.unlinkSync('cornerstone.zip');
        }
      }
    };

    await checkProgress();


  } catch (err) {
    console.log(err.message);
  }
};
