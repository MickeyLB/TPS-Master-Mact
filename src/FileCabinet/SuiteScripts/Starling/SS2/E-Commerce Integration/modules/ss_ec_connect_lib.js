/**
 * This script was provided by Starling Solutions.
 *
 * API Connections to eCommerce
 *
 *  Version		Date				Author				Remarks
 *************************************************************************
 *  1.0			24 Mar 2018			Mark Baker			Initial Version
 *  1.1			20 Aug 2019			Devon Rimmington	TPS-173			Added logic for updated API's
 *************************************************************************
 */


define(['N/https', 'N/email', 'N/url', 'N/record', 'N/runtime', 'N/search'],
    function(https, email, url, record, runtime, search) {
        const NOTIFICATION_AGENT = '16662';
        const SS_USER = 11633; // Starling solutions 1
        const SS_EMAIL = 'dimitry.mazur@starlingsoultions.com';
        const TESTING = false;
        const ACTION = {
            DELETE_FULFILLMENT  : 'deleteFulfillment',
            CREATE_PRODUCT      : 'createProduct',
            UPDATE_PRODUCT      : 'updateProduct',
            CREATE_ORDER        : 'createOrder',
            UPDATE_ORDER        : 'updateOrder',
        };

        const API_KEY = '9%j23Ulpwx^O$plh9S7saxS7WWc7T8';
        const ADMIN_EMAIL = 'dimitry.mazur@starlingsolutions.com';

        function sendPost(body, addData) {

            // verify that the accountIdentifier is for the current account that is executing the request.

            if(body.accountIdentifier !== 'InvestorsGroupDev' && body.accountIdentifier.toUpperCase().indexOf(runtime.envType) === -1 ){
                log.error({ title : 'Executing in ' + runtime.envType, details : 'FOUND Account Identifier ' + body.accountIdentifier + ' in the ' + runtime.envType + ' account' });
                throw 'Error - Check the logs for the cause of the error';
            }

            if (!body || !body.accountIdentifier) {
                log.debug({title: 'accountIdentifier missing received: ' + body.accountIdentifier, details: body });
                return;
            }

            if (!body || !body.action) {
                log.debug({title: 'Action Missing in body', details: body });
                return;
            }

            var endpoint = getEndpoint(body.accountIdentifier);
            if (!endpoint) {
                log.debug({title: 'No endpoint set up for ' + body.accountIdentifier, details: body });
                return;
            }

            var numberOfRequestAttemtps = 10;
            var successfulRequest       = false;
            var lastErrorResponseText   = '';
            log.debug({ title : 'sendPost Request', details: JSON.stringify(body)});

            while(!successfulRequest && numberOfRequestAttemtps > 0) {
                try {
                    var response = https.request({
                        method: https.Method.POST,
                        url: endpoint,
                        headers: {'apiKey': API_KEY, 'Content-Type': 'application/json;charset=utf-8', },
                        body: JSON.stringify(body),
                    });
                    log.debug({title: 'sendPost Response ', details: JSON.stringify(response)});
                    successfulRequest = true;
                } catch (e) {
                    lastErrorResponseText = e;
                    log.error({title: 'ERROR', details: e});
                }

                numberOfRequestAttemtps--;
            }

            if (!response) {
                sendNotificationEmail(true, addData, body,  lastErrorResponseText, 'No response');
                saveCommunicationRecord(body, {body: lastErrorResponseText}, addData);
                return;
            }
            if (!response.body) {
                sendNotificationEmail(true, addData, body,  response, 'No body');
                saveCommunicationRecord(body, {body: response}, addData);
                return;
            }

            try {
                var parsedResBody = JSON.parse(response.body.replace(/\n/g, "").replace(/\r/g, "").replace(/\t/g, "").replace(/“/g, '"'));

                if ( (parsedResBody.statusMessage).indexOf('NOTE: Overfulfill on itemInternalId') !== -1) {
                    sendWarningEmail(true, addData, body, response, parsedResBody.statusMessage);
                }
                else if (parsedResBody.success != true ) {
                    sendNotificationEmail(true, addData, body, response, parsedResBody.statusMessage);
                }

                saveCommunicationRecord(body, response, addData);
                return response;
            }
            catch (e) {
                sendNotificationEmail(true, addData, body, response, 'Body could not be parsed');
                saveCommunicationRecord(body, {body: response}, addData);
                return;
            }
        }

        function saveCommunicationRecord(body, response, addData) {
            try {
                var parsedResponse = JSON.parse(JSON.stringify(response));
            }
            catch(e) {
                var parsedResponse = {};
            }

            log.audit({ title : 'saveCommunicationRecord' , details: JSON.stringify([body, response, addData]) });

            try {
                var newComRec = record.create({type: 'customrecord_ss_ec_communication'});

                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_direction',      value: 'Outgoing'});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_ec_payload',     value: JSON.stringify(response, null, 2)});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_ns_payload',     value: JSON.stringify(body, null, 2)});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_action',         value: body.action});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_resolved',       value: false});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_parent_so',      value: (body.nsTransactionId ? body.nsTransactionId : body.nsOrderId)});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_tx_or_item_id',      value: (body.nsTransactionId ? body.nsTransactionId : body.nsOrderId)});
                newComRec.setValue({fieldId: 'custrecord_ss_ec_com_timestamp',      value: new Date() });

                if(body.action === ACTION.CREATE_PRODUCT || body.action === ACTION.UPDATE_PRODUCT ) {

                    if (body.ProductNSID && addData.itemType) {
                        var inActiveLookup = search.lookupFields({type: addData.itemType, id: body.ProductNSID, columns: ['isinactive']});
                        if (inActiveLookup && !inActiveLookup.isinactive) {
                            newComRec.setValue({
                                fieldId: 'custrecord_ss_ec_com_parent_item',
                                value: body.ProductNSID
                            });
                        }
                        else {
                            log.error({title: 'Could not reference Inactive Item #' + body.ProductNSID, details: addData})
                        }
                    }

                    if (response.body) {
                        try {
                            var resParsedBody = JSON.parse(response.body);
                        }
                        catch(e) {
                            var resParsedBody = {success: false, statusMessage: 'No status message', body : response.body }
                        }

                        var isSuccess = resParsedBody.success;

                        if (!isSuccess || isSuccess === 'false') {
                            newComRec.setValue({fieldId: 'custrecord_ss_ec_com_warnings', value: resParsedBody.statusMessage });
                        }
                        else {
                            record.submitFields({type: addData.itemType, id: String(body.ProductNSID), values: {
                                    custitem_ss_ec_cat_changed      : false,
                                    custitem_ss_ec_image_changed    : false,
                                }});
                        }

                        log.debug({title: 'addData.itemType ' + addData.itemType, details: 'body.ProductNSID ' + body.ProductNSID + ' , resParsedBody ' + JSON.stringify(resParsedBody)});

                        if (resParsedBody && resParsedBody.ecProductID) {
                            log.debug({title: 'update Parent/Standalone Item #'+body.ProductNSID, details: 'EC ID: ' + resParsedBody.ecProductID  });

                            // Update the parent/standalone with the EC ID
                            record.submitFields({type: addData.itemType, id: String(body.ProductNSID), values: {
                                    custitem_ss_ec_ec_id : resParsedBody.ecProductID,
                                }
                            });

                            // Update Children with the EC ID
                            var itemSearchResults = getSearchResults(search.create({
                                type: "item",
                                filters: [
                                    ["parent", "anyof", String(body.ProductNSID)],
                                    'AND',
                                    ['internalid', 'noneof', String(body.ProductNSID)],
                                    'AND',
                                    ['custitem_ss_ec_ec_id', 'isnot', String(resParsedBody.ecProductID) ]
                                ],
                            }));
                            itemSearchResults.forEach(function(result){
                                record.submitFields({type: addData.itemType, id: result.id, values: {
                                        custitem_ss_ec_ec_id : resParsedBody.ecProductID,
                                    }
                                });
                            })
                        }
                    }
                }

                else if(body.action !== ACTION.DELETE_FULFILLMENT) {
                    newComRec.setValue({ fieldId : 'custrecord_ss_ec_com_parent_so', value	: (body.nsTransactionId ? body.nsTransactionId : body.nsOrderId) });
                    newComRec.setValue({ fieldId : 'custrecord_ss_ec_tx_or_item_id', value	: (body.nsTransactionId ? body.nsTransactionId : body.nsOrderId) });
                }

                else{
                    newComRec.setValue({fieldId	: 'custrecord_ss_ec_com_parent_so', value	: body.nsOrderId });
                    newComRec.setValue({fieldId	: 'custrecord_ss_ec_tx_or_item_id', value	: body.nsOrderId });
                }

                try {
                    if (parsedResponse.body && parsedResponse.body.indexOf('success') !== -1 && parsedResponse.body.indexOf('statusMessage') !== -1) {
                        if ((JSON.parse(parsedResponse.body)).success) {
                            newComRec.setValue({fieldId: 'custrecord_ss_ec_com_success', value: true});
                        }
                    }
                }
                catch (e) {
                    log.error({title: 'could not parse body correctly', details: response.body })
                }

                var newComRecId = newComRec.save();
                log.debug({title: 'Saved Communication record', details: newComRecId });

            }
            catch(e) {
                log.error({title: 'Could not save communication record', details: JSON.stringify(e)});
            }
        }


        function sendNotificationEmail(isActionNeeded, addData, body, response, message) {
            log.debug({ title : 'sendNotificationEmail :' + message, details: JSON.stringify(response)});
            var isStarling              = runtime.getCurrentUser().id === SS_USER;

            email.send({
                recipients: (TESTING && isStarling) ? SS_EMAIL : getRecipients(body.accountIdentifier, body.action, isActionNeeded, addData),
                subject: 'Failure to update EC account ' + body.accountIdentifier + ': ' + message,
                body: 'Outgoing call:<br>' + jsonToTable(JSON.stringify(body)) +
                    '<br><br>Additional Information:<br>' + jsonToTable(JSON.stringify(addData || {data: 'No Additional Data'} )) +
                    '<br><br>Response: <br>' + jsonToTable(JSON.stringify(response)),
                author: NOTIFICATION_AGENT
            });

        }

        function sendWarningEmail(isActionNeeded, addData, body, response, message) {
            log.debug({ title : 'sendWarningEmail :' + message, details: JSON.stringify(response)});
            var isStarling              = runtime.getCurrentUser().id === SS_USER;

            email.send({
                recipients: (TESTING && isStarling) ? SS_EMAIL : getRecipients(body.accountIdentifier, body.action, isActionNeeded, addData),
                subject: 'Warning at EC account ' + body.accountIdentifier + ': ' + message,
                body: 'Outgoing call :<br>' + jsonToTable(JSON.stringify(body)) + '<br><br>Response: <br>' + jsonToTable(JSON.stringify(response)),
                author: NOTIFICATION_AGENT
            });
        }

        function jsonToTable(jsonString) {
            try {
                var data = JSON.parse(jsonString.replace(/\n/g, "").replace(/\r/g, "").replace(/\t/g, "").replace(/“/g, '"'));
                var table = '<table border=1 cellpadding="5" style="border-collapse: collapse; margin: 0 auto"><tr><th>Key</th><th>Value</th></tr>';
                Object.keys(data).forEach(function (key) {
                    if (key === 'items' || key === 'packages' || key === 'body') {
                        return;
                    }
                    if (key === 'nsTransactionName' && data.nsTransactionId) {
                        try {
                            var recordType  = search.lookupFields({type: 'transaction', id: data.nsTransactionId, columns: ['recordtype']}).recordtype;
                            var txUrl       = 'https://' + url.resolveDomain({hostType: url.HostType.APPLICATION}) + url.resolveRecord({recordType : recordType, recordId: data.nsTransactionId});
                            var txLink      = '<a href="'+ txUrl +'">'+data.nsTransactionName+'</a>';
                            var tableValue  = txLink;
                        }
                        catch(e){
                            var tableValue = JSON.stringify(data[key]);
                        }
                    }
                    else {
                        var tableValue = JSON.stringify(data[key]);
                    }

                    table += '<tr><td>' + key + '</td><td>' + tableValue + '</td></tr>';
                });
                table += '</table>';

                if (data.body) {
                    var parsedBody = JSON.parse(data.body) || data.body;
                    table += '<br>Body: <table border=1 cellpadding="5" style="border-collapse: collapse; margin: 0 auto">';
                    Object.keys(parsedBody).forEach(function (key) {
                        table += '<tr><td>' + key + '</td><td>' + JSON.stringify(parsedBody[key]) + '</td></tr>';
                    });
                    table += '</table>';
                }

                if (data.packages && data.packages[0]) {
                    table += '<br>Packages:<table border=1 cellpadding="5" style="border-collapse: collapse; margin: 0 auto">';
                    table += '<tr><th>Line</th>';
                    Object.keys(data.packages[0]).forEach(function (key) {
                        table += '<th>' + key + '</th>';
                    });
                    table += '</tr>';

                    data.packages.forEach(function (item, i) {
                        table += '<tr><td>' + i + '</td>';
                        Object.keys(data.packages[0]).forEach(function (key) {
                            table += '<th>' + JSON.stringify(item[key]) + '</th>';
                        });
                        table += '</tr>';
                    });
                    table += '</table>';
                }

                if (data.items && data.items[0]) {
                    table += '<br>Items:<table border=1 cellpadding="5" style="border-collapse: collapse; margin: 0 auto">';
                    table += '<tr><th>Line</th>';
                    table += '<th>SKU</th>';

                    Object.keys(data.items[0]).forEach(function (key) {
                        table += '<th>' + key + '</th>';
                    });
                    table += '</tr>';

                    data.items.forEach(function (item, i) {
                        try {
                            // TODO make a singular search
                            var itemLookup  = search.lookupFields({type: 'item', id: item.itemInternalId, columns: ['recordtype', 'itemid'] });
                            var recordType  = itemLookup.recordtype;
                            var itemSKU     = itemLookup.itemid;
                            var itemUrl     = 'https://' + url.resolveDomain({hostType: url.HostType.APPLICATION}) + url.resolveRecord({recordType : recordType, recordId: item.itemInternalId});
                            var itemLink    = '<a href="'+ itemUrl +'">'+itemSKU+'</a>';
                        }
                        catch(e) {
                            var itemLink = 'Item ID #' + item.itemInternalId+ ' Not found';
                        }

                        table += '<tr><td>' + i + '</td><td>'+itemLink+'</td>';
                        Object.keys(data.items[0]).forEach(function (key) {
                            table += '<th>' + JSON.stringify(item[key]) + '</th>';
                        });
                        table += '</tr>';
                    });
                    table += '</table>';
                }
                return table;
            }
            catch(e) {
                return jsonString;
            }
        }

        function getRecipients (accountIdentifier, action, isActionNeeded, addData) {
            if (!accountIdentifier || !action) {
                log.error({title: 'Missing accountIdentifier or action parameters in getRecipients', details: "" });
                return;
            }

            var isItemHandle    = action === ACTION.CREATE_PRODUCT || action === ACTION.UPDATE_PRODUCT;
            var storeName       = accountIdentifier.replace(/Sandbox/, "").replace(/Production/, "").trim();

            var websiteResults = getSearchResults(search.create({
                type: "customrecord_ss_ec_website",
                filters: [['name', 'is', storeName]],
                columns: [
                    'custrecord_ss_ec_notification_emp',
                    'custrecord_ss_ec_notification_non_emp',
                    'custrecord_ss_ec_item_notification_emp',
                    'custrecord_ss_ec_item_note_non_emp'
                ]
            }));

            if (websiteResults.length !== 1) {
                log.error({title: 'A Custom Record "[SS] Website" is not set up correctly for ' + accountIdentifier, details: "" });
                return;
            }

            var recipientsRaw   = websiteResults[0].getValue({name: isItemHandle ? "custrecord_ss_ec_item_notification_emp" : "custrecord_ss_ec_notification_emp" }) || "";
            var recipients      = recipientsRaw.split(',');

            var nonEmpRecipient = websiteResults[0].getValue({name: "custrecord_ss_ec_notification_non_emp" }) || "";
            if (nonEmpRecipient && !isItemHandle && isActionNeeded) {
                recipients.push(nonEmpRecipient);
            }
            recipients.push(ADMIN_EMAIL);

            if (addData && addData.userEmail) {
                recipients.push(addData.userEmail);
            }

            return recipients;
        }

        function getEndpoint (accountIdentifier) {

            var isSandbox       = runtime.envType === runtime.EnvType.SANDBOX;
            var storeName       = accountIdentifier.replace(/Sandbox/, "").replace(/Production/, "").trim();

            var websiteResults = getSearchResults(search.create({
                type: "customrecord_ss_ec_website",
                filters: [['name', 'is', storeName]],
                columns: ['custrecord_ss_ec_prod_endpoint', 'custrecord_ss_ec_sand_endpoint']
            }));

            if (websiteResults.length !== 1) {
                log.error({title: 'A Custom Record "[SS] Website" is not set up correctly for ' + accountIdentifier, details: "" });
                return;
            }

            return websiteResults[0].getValue({name: (isSandbox ? 'custrecord_ss_ec_sand_endpoint' : 'custrecord_ss_ec_prod_endpoint') });
        }


        function getSearchResults(thisSearch) {

            var results = [];
            var pagedData = thisSearch.runPaged({pageSize: 1000});

            if (pagedData.count == 0) {
                return results;
            }

            var page = pagedData.fetch({index: 0});
            results = page.data;

            while (!page.isLast) {
                page = page.next();
                results = results.concat(page.data);
            }

            return results;
        }



        return {
            sendPost	    : sendPost,
            getEndpoint     : getEndpoint,
            getRecipients   : getRecipients,
        }

    });