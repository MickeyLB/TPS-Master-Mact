/*
 * Copyright (c) 2022. Pierre J.-L. Plourde and 2390319 Ontario Limited dba TPS Promotions & Incentives
 */

const SuiteCloudJestUnitTestRunner = require('@oracle/suitecloud-unit-testing/services/SuiteCloudJestUnitTestRunner');

module.exports = {
	defaultProjectFolder: 'src',
	commands: {
		'project:deploy': {
			beforeExecuting: async args => {
				await SuiteCloudJestUnitTestRunner.run({
					// Jest configuration options.
				});
				return args;
			}
		}
	}
};
