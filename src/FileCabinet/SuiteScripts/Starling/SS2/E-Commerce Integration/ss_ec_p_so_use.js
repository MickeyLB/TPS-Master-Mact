/*
 * Copyright (c) 2022. Pierre J.-L. Plourde and 2390319 Ontario Limited dba TPS Promotions & Incentives
 */

/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * This script was provided by Starling Solutions.
 * It notifies the central e-commerce Suitlet of changes to SO status when approving SO, fulfilling or invoicing.
 * It also notifies on creating a new SO or Item Fulfillement.
 * It also shows warning text on form if items have different prices than in EC
 *
 *  Version     Date                Author              Ticket			Remarks
 ***************************************************************************************************************
 *  1.0			27 Mar 2018			Dimitry Mazur						Initial Version
 *	1.1			20 Aug 2019			Devon Rimmington	TPS-173			Added logic for updated API's
 *	1.2			01 Nov 2019			Jonathan MacKenzie	TPS-202		    Added logic for closing/ cancelling SO's
 ***************************************************************************************************************
 *  Custom fields used:
 *
 *  custbody_ss_ec_acc_identifier  		- Stores the EC account from which the sales order was operated.
 *  custbody_ss_do_not_notify_customer 	- Signals EC to notify customer of Item Fulfillment, Item fulfillment. Checkbox.
 *  custbody_ss_so_old_status      		- Stamp of order status before the script took effect. Used to listen to SO status changes on Item Fulfillment and Invoice creations.
 *  custpage_items_price_warning   		- Displays price difference warning. Inline HTML field, added to SO in script to the form.
 *  custbody_ss_pst_invalid	       		- Checkbox on SO that signals that the customer with PST code uses a shipping address not valid
 */

define(['N/runtime', 'N/email', 'N/url', 'N/https', 'N/search', 'N/record', 'N/ui/serverWidget', 'N/format', './modules/ss_ec_connect_lib.js'],


    function (runtime, email, url, https, search, record, serverWidget, format, connect) {
        const STATUSES = {
            'A': 'Pending Approval',
            'B': 'Pending Fulfillment',
            'C': 'Cancelled',
            'D': 'Partially Fulfilled',
            'E': 'Pending Billing/Partially Fulfilled',
            'F': 'Pending Billing',
            'G': 'Billed',
            'H': 'Closed'
        };

        const REVERSEMAPSTATUSES = {
            'pendingApproval': 'A',
            'pendingFulfillment': 'B',
            'cancelled': 'C',
            'partiallyFulfilled': 'D',
            'pendingBillingPartFulfilled': 'E',
            'pendingBilling': 'F',
            'fullyBilled': 'G',
            'closed': 'H'
        };

        const NOTIFICATION_AGENT = '16662';
        const CUSTOM_ITEM_IDS = ['4882', 4882, '9207', 9207];

        /**
         * Function definition to be triggered before record is loaded.
         *
         * @param {Object} scriptContext
         * @param {Record} rec - New record
         * @param {string} scriptContext.type - Trigger type
         * @param {Form} scriptContext.form - Current form
         * @Since 2015.2
         */
        function beforeLoad(scriptContext) {
            if (runtime.executionContext != runtime.ContextType.USER_INTERFACE) {
                return;
            }

            var rec = scriptContext.newRecord;
            var accountIdentifier = rec.getValue({fieldId: 'custbody_ss_ec_acc_identifier'});

            if (rec.type == record.Type.SALES_ORDER && scriptContext.type == scriptContext.UserEventType.COPY) {
                rec.setValue({fieldId: 'custbody_ss_ec_transaction_id', value: ''});
                rec.setValue({fieldId: 'custbody_ss_ec_invoice_comment', value: ''});
                rec.setValue({fieldId: 'custbody_ss_ec_acc_identifier', value: ''});
                return;
            }

            if (rec.type !== record.Type.SALES_ORDER || !accountIdentifier) {
                return;
            }

            // Add a message to the SO form if we have item price difference
            var changesString = '';

            for (var i = 0; i < rec.getLineCount({sublistId: 'item'}); i++) {

                var thisClass = rec.getSublistValue({sublistId: 'item', fieldId: 'class', line: i});
                var itemId = rec.getSublistValue({sublistId: 'item', fieldId: 'item', line: i});

                // log.debug({title: 'TX ID ' + scriptContext.newRecord.id + ' Item ID ' + itemId + ' Class', details: thisClass});

                if (CUSTOM_ITEM_IDS.indexOf(itemId) !== -1) {	// TPS Additional Items for customization purposes
                    continue;
                }

                var linePrice = rec.getSublistValue({sublistId: 'item', fieldId: 'rate', line: i});
                var priceLevel = rec.getSublistText({sublistId: 'item', fieldId: 'price', line: i});
                var itemName = rec.getSublistText({sublistId: 'item', fieldId: 'item', line: i});
                var itemType = rec.getSublistValue({sublistId: 'item', fieldId: 'custcol_ss_item_type', line: i});

                // log.debug({title: 'itemType tx id ' + scriptContext.newRecord.id, details: itemType});

                if (priceLevel == '' && itemType !== 'Description') { // 'Custom Price Level
                    changesString += '<br>Custom Price Level: Item <b>' + itemName + '</b>, line <b>' + i + '</b>, Line Price <b>' + linePrice + '</b>';
                }
            }

            var warningHtml = '';

            if (changesString) {
                warningHtml += '<font color="red" size="3">Caution: Some items have pricing discrepancies. Please review.</font>' + changesString;
            }

            // log.debug({title: 'warningHtml', details: warningHtml})
            if (warningHtml) {
                var warningField = scriptContext.form.addField({id: 'custpage_items_price_warning', label: 'Items Price Warning', type: serverWidget.FieldType.INLINEHTML});
                warningField.updateLayoutType({layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE});
                warningField.defaultValue = warningHtml;
            }
        }

        /**
         * Function definition to be triggered before record is loaded.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type
         * @Since 2015.2
         */
        function beforeSubmit(scriptContext) {
            // log.debug({ title : 'Before submit on ' + scriptContext.type, details : 'ID: ' + scriptContext.newRecord ? scriptContext.newRecord.id : scriptContext.oldRecord.id });
        }


        /**
         * Function definition to be triggered before record is loaded.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type
         * @Since 2015.2
         */
        function afterSubmit(scriptContext) {
            log.debug({title: 'After submit on ' + scriptContext.type, details: 'ID: ' + scriptContext.newRecord.id + ' Record Type: ' + scriptContext.newRecord.type});

            var thisRecord = (scriptContext.type !== scriptContext.UserEventType.DELETE) ? scriptContext.newRecord : scriptContext.oldRecord;
            var doNotUpdateEC = thisRecord.getValue({fieldId: 'custbody_ss_do_not_update_ec'});
            var accountIdentifier = thisRecord.getValue({fieldId: 'custbody_ss_ec_acc_identifier'});
            var createdFrom = thisRecord.getValue({fieldId: 'createdfrom'});
            var ecOrderId = thisRecord.getValue({fieldId: 'custbody_ss_ec_transaction_id'});

            if (doNotUpdateEC) {
                return;
            }

            if (thisRecord.type === record.Type.SALES_ORDER) {

                if (scriptContext.type === scriptContext.UserEventType.DELETE) {

                    var PONum = thisRecord.getValue({fieldId: 'otherrefnum'});
                    if (PONum.indexOf('WID#') === 0) {
                        email.send({
                            author: NOTIFICATION_AGENT,
                            recipients: connect.getRecipients(accountIdentifier, 'deleteRecord', false),
                            subject: 'NS EC Bridge - NS Record Deleted',
                            body: 'The ' + thisRecord.type + ' with ID of ' + thisRecord.id + ' has been deleted for ' + accountIdentifier + '. The Web Store Order reference is ' + PONum + '. If this was anticipated, please ignore this message.'
                        });
                    }
                    return;
                }

                if (scriptContext.type === scriptContext.UserEventType.XEDIT) {
                    var soRec = record.load({type: record.Type.SALES_ORDER, id: thisRecord.id});
                    accountIdentifier = soRec.getValue({fieldId: 'custbody_ss_ec_acc_identifier'});
                    ecOrderId = soRec.getValue({fieldId: 'custbody_ss_ec_transaction_id'});
                } else {
                    var soRec = thisRecord;
                }
            } else {
                if ( !createdFrom) {
                    return;
                }

                var createdFromType = search.lookupFields({type: search.Type.TRANSACTION, id: createdFrom, columns: ['recordtype']}).recordtype;

                if (createdFromType !== record.Type.SALES_ORDER) {
                    return;
                }

                var soRec = record.load({type: createdFromType, id: createdFrom});
                accountIdentifier = soRec.getValue({fieldId: 'custbody_ss_ec_acc_identifier'});
                ecOrderId = soRec.getValue({fieldId: 'custbody_ss_ec_transaction_id'});

                if (thisRecord.type === record.Type.ITEM_FULFILLMENT) {
                    var ecShipmentId = thisRecord.getValue({fieldId: 'custbody_ss_ec_shipment_id'});
                }
                if (thisRecord.type === record.Type.INVOICE) {
                    var ecInvoiceId = thisRecord.getValue({fieldId: 'custbody_ss_ec_invoice_id'});
                }
            }

            var statusRef = search.lookupFields({type: soRec.type, id: soRec.id, columns: 'status'}).status[0].value;
            var newSoStatus = REVERSEMAPSTATUSES[statusRef];

            log.debug({
                title: '#' + scriptContext.newRecord.id + '[statusRef, newSoStatus, ecOrderId, ecShipmentId, ecInvoiceId, accountIdentifier]',
                details: [statusRef, newSoStatus, ecOrderId, ecShipmentId, ecInvoiceId, accountIdentifier]
            });

            if (( !ecOrderId && !ecShipmentId && !ecInvoiceId) || !accountIdentifier || !newSoStatus) {
                return;
            }

            // ************** Update Sales Order Status If Changed ****************
            salesOrderEC(scriptContext, soRec, accountIdentifier, ecOrderId, newSoStatus);

            // ************** Create, Updated, Delete Item Fulfillment ****************
            itemFulfillmentEC(scriptContext, soRec, accountIdentifier, ecShipmentId, newSoStatus);

            // ************** Create Invoice ****************
            invoiceEC(scriptContext, soRec, accountIdentifier);
        }

        // Helper Functions

        /**
         * Update Sales Order record status in EC when it has changed.
         *
         * @param scriptContext
         * @param soRec
         * @param accountIdentifier
         * @param ecOrderId
         */
        function salesOrderEC(scriptContext, soRec, accountIdentifier, ecOrderId, newSoStatus) {
            log.debug({title: 'salesOrderEC vars ', details: [runtime.executionContext, soRec.id, accountIdentifier, ecOrderId, newSoStatus]});

            var thisRecord = scriptContext.newRecord;
            // var closedSent = thisRecord.getValue({ fieldId: 'custbody_ss_ec_closed_status_sent'}); // TEMP

            // Deleting Sales Order is not supported in EC
            if (scriptContext.type === scriptContext.UserEventType.DELETE && thisRecord.type === record.Type.SALES_ORDER) {
                return;
            }

            var oldSoStatus = soRec.getValue({fieldId: 'custbody_ss_so_old_status'}) || 'A';
            if (newSoStatus === oldSoStatus) {
                return;
            }

            var valuesToUpdate = {'custbody_ss_so_old_status': newSoStatus};
            record.submitFields({type: record.Type.SALES_ORDER, id: soRec.id, values: valuesToUpdate, ignoreMandatoryFields: true});

            var newStatus = STATUSES[newSoStatus];
            if (newStatus === 'Closed') {
                if (salesOrderHasFulfillments(thisRecord.id)) {
                    newStatus = 'Billed';
                } else {
                    newStatus = 'Cancelled';
                }
            }

            connect.sendPost({
                action: 'updateSalesOrderStatus',
                accountIdentifier: accountIdentifier,
                ecTransactionId: ecOrderId,
                nsTransactionId: soRec.id,
                nsTransactionName: soRec.getValue({fieldId: 'tranid'}),
                newStatus: newStatus,
                effectiveDate: format.format({value: new Date(), type: format.Type.DATE})
            });
        }

        /**
         * Create, Update, Delete an Item Fulfillment in EC
         *
         * @param scriptContext
         * @param soRec
         * @param accountIdentifier
         * @param ecShipmentId
         */
        function itemFulfillmentEC(scriptContext, soRec, accountIdentifier, ecShipmentId, newSoStatus) {
            var thisRecord = scriptContext.newRecord;
            var form = scriptContext.form;

            if (
                thisRecord.type === record.Type.ITEM_FULFILLMENT &&
                (scriptContext.type === scriptContext.UserEventType.CREATE || scriptContext.type === scriptContext.UserEventType.EDIT)
            ) {
                // Loading the record again is a workaround to get Tracking Numbers
                thisRecord = record.load({type: record.Type.ITEM_FULFILLMENT, id: thisRecord.id, isDynamic: true});
                var packages = [];

                for (var i = 0; i < thisRecord.getLineCount({sublistId: 'package'}); i++) {
                    packages.push({
                        trackingNumbers: thisRecord.getSublistValue({sublistId: 'package', fieldId: 'packagetrackingnumber', line: i}),
                        packageId: thisRecord.getSublistValue({sublistId: 'package', fieldId: 'trackingnumberkey', line: i}),
                        weight: thisRecord.getSublistValue({sublistId: 'package', fieldId: 'packageweight', line: i}),
                        description: thisRecord.getSublistValue({sublistId: 'package', fieldId: 'packagedescr', line: i})
                    });
                }
                for (var i = 0; i < thisRecord.getLineCount({sublistId: 'packageups'}); i++) {
                    packages.push({
                        trackingNumbers: thisRecord.getSublistValue({sublistId: 'packageups', fieldId: 'packagetrackingnumberups', line: i}),
                        packageId: thisRecord.getSublistValue({sublistId: 'packageups', fieldId: 'trackingnumberkeyups', line: i}),
                        weight: thisRecord.getSublistValue({sublistId: 'packageups', fieldId: 'packageweightups', line: i}),
                        description: thisRecord.getSublistValue({sublistId: 'packageups', fieldId: 'packagedescrups', line: i})
                    });
                }


                if (packages.length === 0) {
                    packages.push({trackingNumbers: '', packageId: '', weight: '', description: ''});
                }

                var items = [];

                for (var i = 0; i < thisRecord.getLineCount({sublistId: 'item'}); i++) {

                    //case #37 Kit/Package Items Creating Multiple Lines in EC Payloads from ITF Records #37
                    //BPC Code
                    var lineType = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'custcol_ss_ec_line_type', line: i});
                    if(lineType === "Main Line") {
                        //End BPC Code
                        var itemId = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'item', line: i});
                        var lineNumber = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'line', line: i});
                        var nativeLineId = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'custcol_ss_ec_line_id', line: i});
                        var displayLineId = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'custcol_ss_ec_line_iddisp', line: i}); // TPS-348. Results of setting of VIEW FROM ORDER ONLY field.
                        var soRecLine = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'orderline', line: i});
                        var soLineID = 0;
                        if (soRecLine) {
                            soLineID = soRec.getSublistValue({sublistId: 'item', fieldId: 'custcol_ss_ec_line_id', line: soRecLine - 1});   // The lines here count from 1 and up
                        }
                        var orderLineId = nativeLineId || displayLineId || soLineID;

                        log.audit({title: 'lineNumber, itemId, orderLineId', details: [lineNumber, itemId, orderLineId]});

                        var quantity = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: i});
                        var itemReceive = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'itemreceive', line: i});

                        var ifFields = thisRecord.getSublistFields({sublistId: 'item'}).sort();
                        var ifFieldValues = {};
                        ifFields.forEach(function (fieldId) {
                            ifFieldValues[fieldId] = thisRecord.getSublistValue({sublistId: 'item', fieldId: fieldId, line: i});
                        });
                        log.debug({title: 'If field Values for line ' + i, details: ifFieldValues});

                        if ( !itemReceive || !quantity || CUSTOM_ITEM_IDS.indexOf(itemId) !== -1) {
                            continue;
                        }

                        var itemType = search.lookupFields({type: 'item', id: itemId, columns: ['type']}).type[0].value;
                        if (itemType === 'GiftCert') {	// Gift Cards are not to be sent notification as fulfilled
                            continue;
                        }

                        if (orderLineId) {
                            items.push({
                                itemInternalId: itemId,
                                quantityShipped: quantity,
                                orderLineId: orderLineId
                            });
                        }
                    }
                }

                if ( !items.length) {
                    return;
                }

                var ecCarrier = 'Other';
                if (thisRecord.getText({fieldId: 'shipmethod'}) === 'Canada Post') {
                    ecCarrier = 'Canada Post';
                }
                if (thisRecord.getText({fieldId: 'shipmethod'}).indexOf('UPS') !== -1) {
                    ecCarrier = 'UPS';
                }
                if (thisRecord.getText({fieldId: 'shipmethod'}).indexOf('FedEx') !== -1) {
                    ecCarrier = 'FedEx';
                }

                var trandate = thisRecord.getValue({fieldId: 'trandate'});
                var rawDate = (trandate) ? new Date(trandate) : new Date();
                var formattedDate = format.format({value: rawDate, type: format.Type.DATE});


                var payload = {
                    action: ecShipmentId ? 'updateFulfillment' : 'createFulfillment',
                    accountIdentifier: accountIdentifier,
                    nsTransactionName: search.lookupFields({type: thisRecord.type, id: thisRecord.id, columns: 'tranid'}).tranid,
                    nsTransactionId: thisRecord.id,
                    ecOrderId: soRec.getValue({fieldId: 'custbody_ss_ec_transaction_id'}),
                    nsOrderId: soRec.id,
                    date: formattedDate,
                    carrier: ecCarrier,
                    fullOrderShipped: (newSoStatus === 'F'),
                    packages: packages,
                    items: items,
                    notifyCustomer: !thisRecord.getValue({fieldId: 'custbody_ss_do_not_notify_customer'})
                };

                if (ecShipmentId) {
                    payload.ecTransactionId = ecShipmentId;
                }

                log.debug({title: 'payload ' + payload.action + ' NS ID #' + payload.nsOrderId, details: payload});

                var response = connect.sendPost(payload);
                if ( !response || !response.body) {
                    return;
                }

                log.audit({title: 'response', details: response});

                // ecShipmentId will only be provided when a new shipment is created in EC
                var newECShipmentId = JSON.parse(response.body).ecTransactionId;

                if (newECShipmentId) {
                    record.submitFields({
                        type: thisRecord.type,
                        id: thisRecord.id,
                        values: {
                            custbody_ss_ec_shipment_id: newECShipmentId
                        }
                    });
                }
            } else if (thisRecord.type === record.Type.ITEM_FULFILLMENT && scriptContext.type === scriptContext.UserEventType.DELETE) {

                if ( !ecShipmentId) {
                    log.error({title: 'No ecShipmentId, could not update EC order ' + soRec.getValue({fieldId: 'custbody_ss_ec_transaction_id'}), details: 'Internal Id ' + thisRecord.id});
                    return;
                }

                var payload = {
                    action: 'deleteFulfillment',
                    accountIdentifier: accountIdentifier,
                    nsTransactionId: thisRecord.id,
                    ecTransactionId: ecShipmentId,
                    ecOrderId: soRec.getValue({fieldId: 'custbody_ss_ec_transaction_id'}),
                    nsOrderId: soRec.id
                };

                log.audit({title: 'Delete IF payload', details: payload});
                connect.sendPost(payload);
            }
        }

        /**
         * Create an Invoice in EC
         *
         * @param scriptContext
         * @param soRec
         * @param accountIdentifier
         */

        function invoiceEC(scriptContext, soRec, accountIdentifier) {
            log.debug({title: 'invoiceEC ' + scriptContext.newRecord.id});

            var thisRecord = scriptContext.newRecord;

            if (thisRecord.type === record.Type.INVOICE && scriptContext.type === scriptContext.UserEventType.CREATE) {

                if (soRec.getValue({fieldId: 'custbody_ss_ec_invoice_comment'})) {
                    var newMemo = thisRecord.getValue({fieldId: 'memo'}) ? (soRec.getValue({fieldId: 'custbody_ss_ec_invoice_comment'}) + ' | ' + thisRecord.getValue({fieldId: 'memo'})) : soRec.getValue({fieldId: 'custbody_ss_ec_invoice_comment'});
                    thisRecord.setValue({fieldId: 'memo', value: newMemo});
                }

                var items = [];

                for (var i = 0; i < thisRecord.getLineCount({sublistId: 'item'}); i++) {

                    if (thisRecord.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: i})) {

                        var quantity = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: i});
                        var itemId = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'item', line: i});
                        var orderLineId = thisRecord.getSublistValue({sublistId: 'item', fieldId: 'custcol_ss_ec_line_id', line: i});

                        var invFields = thisRecord.getSublistFields({sublistId: 'item'}).sort();
                        var invFieldValues = {};
                        invFields.forEach(function (fieldId) {
                            invFieldValues[fieldId] = thisRecord.getSublistValue({sublistId: 'item', fieldId: fieldId, line: i});
                        });

                        log.debug({title: 'Invoice field Values for line ' + i, details: invFieldValues});

                        if ( !quantity || CUSTOM_ITEM_IDS.indexOf(itemId) !== -1) {
                            continue;
                        }

                        if (orderLineId) {
                            items.push({
                                id: itemId,
                                itemInternalId: itemId,
                                quantity: quantity,
                                orderLineId: orderLineId
                            });
                        }
                    }
                }

                log.debug({title: 'items length ' + items.length});

                if ( !items.length) {
                    return;
                }

                var trandate = thisRecord.getValue({fieldId: 'trandate'});
                var rawDate = (trandate) ? new Date(trandate) : new Date();
                var formattedDate = format.format({value: rawDate, type: format.Type.DATE});

                var payload = {
                    action: 'createInvoice',
                    accountIdentifier: accountIdentifier,
                    nsTransactionName: search.lookupFields({type: thisRecord.type, id: thisRecord.id, columns: 'tranid'}).tranid,
                    nsTransactionId: thisRecord.id,
                    ecOrderId: soRec.getValue({fieldId: 'custbody_ss_ec_transaction_id'}),
                    nsOrderId: soRec.id,
                    date: formattedDate,
                    items: items
                };

                log.audit({title: 'payload', details: payload});

                var response = connect.sendPost(payload);

                if ( !response || !response.body) {
                    return;
                }

                log.audit({title: 'response', details: response});

                var newEcInvoiceId = JSON.parse(response.body).ecTransactionId;

                if (newEcInvoiceId) {
                    record.submitFields({
                        type: thisRecord.type,
                        id: thisRecord.id,
                        values: {
                            custbody_ss_ec_invoice_id: newEcInvoiceId
                        }
                    });
                }
            }
        }

        /**
         * Determine if this Sales Order has Item Fulfillments
         *
         * @param salesOrderId - The ID of the SO to check
         */
        function salesOrderHasFulfillments(salesOrderId) {
            var itemFulfillmentSearch = search.create({
                type: 'itemfulfillment',
                filters: [
                    'createdfrom', 'anyof', salesOrderId
                ]
            });

            log.debug({title: 'salesOrderHasFulfillments', details: JSON.stringify(itemFulfillmentSearch)});
            return itemFulfillmentSearch.runPaged().count > 0;
        }


        return {
            beforeLoad: beforeLoad,
            // beforeSubmit: beforeSubmit,
            afterSubmit: afterSubmit
        };

    });
