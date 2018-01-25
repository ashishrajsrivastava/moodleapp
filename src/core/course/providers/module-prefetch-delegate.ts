// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';
import { CoreEventsProvider } from '../../../providers/events';
import { CoreFileProvider } from '../../../providers/file';
import { CoreFilepoolProvider } from '../../../providers/filepool';
import { CoreLoggerProvider } from '../../../providers/logger';
import { CoreSitesProvider } from '../../../providers/sites';
import { CoreTimeUtilsProvider } from '../../../providers/utils/time';
import { CoreUtilsProvider } from '../../../providers/utils/utils';
import { CoreCourseProvider } from './course';
import { CoreCache } from '../../../classes/cache';
import { CoreSiteWSPreSets } from '../../../classes/site';
import { CoreConstants } from '../../constants';
import { Md5 } from 'ts-md5/dist/md5';
import { Subject, BehaviorSubject, Subscription } from 'rxjs';

/**
 * Progress of downloading a list of modules.
 */
export type CoreCourseModulesProgress = {
    /**
     * Number of modules downloaded so far.
     * @type {number}
     */
    count: number;

    /**
     * Toal of modules to download.
     * @type {number}
     */
    total: number;
};

/**
 * Progress function for downloading a list of modules.
 *
 * @param {CoreCourseModulesProgress} data Progress data.
 */
export type CoreCourseModulesProgressFunction = (data: CoreCourseModulesProgress) => void;

/**
 * Interface that all course prefetch handlers must implement.
 */
export interface CoreCourseModulePrefetchHandler {
    /**
     * A name to identify the addon.
     * @type {string}
     */
    name: string;

    /**
     * Name of the module. It should match the "modname" of the module returned in core_course_get_contents.
     * @type {string}
     */
    modname: string;

    /**
     * The handler's component.
     * @type {string}
     */
    component: string;

    /**
     * The RegExp to check updates. If a module has an update whose name matches this RegExp, the module will be marked
     * as outdated. This RegExp is ignored if hasUpdates function is defined.
     * @type {RegExp}
     */
    updatesNames?: RegExp;

    /**
     * Whether or not the handler is enabled on a site level.
     *
     * @return {boolean|Promise<boolean>} A boolean, or a promise resolved with a boolean, indicating if the handler is enabled.
     */
    isEnabled() : boolean|Promise<boolean>;

    /**
     * Get the download size of a module.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @return {Promise<{size: number, total: boolean}>} Promise resolved with the size and a boolean indicating if it was able
     *                                                   to calculate the total size.
     */
    getDownloadSize(module: any, courseId: number, single?: boolean) : Promise<{size: number, total: boolean}>;

    /**
     * Prefetch a module.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @return {Promise<any>} Promise resolved when done.
     */
    prefetch(module: any, courseId?: number, single?: boolean): Promise<any>;

    /**
     * Check if a certain module can use core_course_check_updates to check if it has updates.
     * If not defined, it will assume all modules can be checked.
     * The modules that return false will always be shown as outdated when they're downloaded.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {boolean|Promise<boolean>} Whether the module can use check_updates. The promise should never be rejected.
     */
    canUseCheckUpdates?(module: any, courseId: number) : boolean|Promise<boolean>;

    /**
     * Return the status to show based on current status. E.g. a module might want to show outdated instead of downloaded.
     * If not implemented, the original status will be returned.
     *
     * @param {any} module Module.
     * @param {string} status The current status.
     * @param {boolean} canCheck Whether the site allows checking for updates.
     * @return {string} Status to display.
     */
    determineStatus?(module: any, status: string, canCheck: boolean) : string;

    /**
     * Get the downloaded size of a module. If not defined, we'll use getFiles to calculate it (it can be slow).
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {number|Promise<number>} Size, or promise resolved with the size.
     */
    getDownloadedSize?(module: any, courseId: number) : number|Promise<number>;

    /**
     * Get the list of files of the module. If not defined, we'll assume they are in module.contents.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {any[]|Promise<any[]>} List of files, or promise resolved with the files.
     */
    getFiles?(module: any, courseId: number) : any[]|Promise<any[]>;

    /**
     * Check if a certain module has updates based on the result of check updates.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @param {any[]} moduleUpdates List of updates for the module.
     * @return {boolean|Promise<boolean>} Whether the module has updates. The promise should never be rejected.
     */
    hasUpdates?(module: any, courseId: number, moduleUpdates: any[]) : boolean|Promise<boolean>;

    /**
     * Invalidate WS calls needed to determine module status. It doesn't need to invalidate check updates.
     * It should NOT invalidate files nor all the prefetched data.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<any>} Promise resolved when invalidated.
     */
    invalidateModule?(module: any, courseId: number) : Promise<any>;

    /**
     * Check if a module can be downloaded. If the function is not defined, we assume that all modules are downloadable.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {boolean|Promise<boolean>} Whether the module can be downloaded. The promise should never be rejected.
     */
    isDownloadable?(module: any, courseId: number) : boolean|Promise<boolean>;

    /**
     * Load module contents in module.contents if they aren't loaded already. This is meant for resources.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<any>} Promise resolved when done.
     */
    loadContents?(module: any, courseId: number) : Promise<any>;

    /**
     * Remove module downloaded files. If not defined, we'll use getFiles to remove them (slow).
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<any>} Promise resolved when done.
     */
    removeFiles?(module: any, courseId: number) : Promise<any>;
};

/**
 * Delegate to register module prefetch handlers.
 */
@Injectable()
export class CoreCourseModulePrefetchDelegate {
    // Variables for database.
    protected CHECK_UPDATES_TIMES_TABLE = 'check_updates_times';
    protected checkUpdatesTableSchema = {
        name: this.CHECK_UPDATES_TIMES_TABLE,
        columns: [
            {
                name: 'courseId',
                type: 'INTEGER',
                primaryKey: true
            },
            {
                name: 'time',
                type: 'INTEGER',
                notNull: true
            }
        ]
    }

    protected ROOT_CACHE_KEY = 'mmCourse:';

    protected logger;
    protected handlers: {[s: string]: CoreCourseModulePrefetchHandler} = {}; // All registered handlers.
    protected enabledHandlers: {[s: string]: CoreCourseModulePrefetchHandler} = {}; // Handlers enabled for the current site.
    protected statusCache = new CoreCache();
    protected lastUpdateHandlersStart: number;

    // Promises for check updates, to prevent performing the same request twice at the same time.
    protected courseUpdatesPromises: {[s: string]: {[s: string]: Promise<any>}} = {};

    // Promises and observables for prefetching, to prevent downloading the same section twice at the same time
    // and notify the progress of the download.
    protected prefetchData: {[s: string]: {[s: string]: {
        promise: Promise<any>,
        observable: Subject<CoreCourseModulesProgress>,
        subscriptions: Subscription[]
    }}} = {};

    constructor(logger: CoreLoggerProvider, private sitesProvider: CoreSitesProvider, private eventsProvider: CoreEventsProvider,
            private courseProvider: CoreCourseProvider, private filepoolProvider: CoreFilepoolProvider,
            private timeUtils: CoreTimeUtilsProvider, private utils: CoreUtilsProvider, private fileProvider: CoreFileProvider) {
        this.logger = logger.getInstance('CoreCourseModulePrefetchDelegate');

        this.sitesProvider.createTableFromSchema(this.checkUpdatesTableSchema);
    }

    /**
     * Check if current site can check updates using core_course_check_updates.
     *
     * @return {boolean} True if can check updates, false otherwise.
     */
    canCheckUpdates() : boolean {
        return this.sitesProvider.getCurrentSite().wsAvailable('core_course_check_updates');
    }

     /**
     * Check if a certain module can use core_course_check_updates.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<boolean>} Promise resolved with boolean: whether the module can use check updates WS.
     */
    canModuleUseCheckUpdates(module: any, courseId: number) : Promise<boolean> {
        const handler = this.getPrefetchHandlerFor(module);

        if (!handler) {
            // Module not supported, cannot use check updates.
            return Promise.resolve(false);
        }

        if (handler.canUseCheckUpdates) {
            return Promise.resolve(handler.canUseCheckUpdates(module, courseId));
        }

        // By default, modules can use check updates.
        return Promise.resolve(true);
    }

    /**
     * Clear the status cache.
     */
    clearStatusCache() : void {
        this.statusCache.clear();
    }

    /**
     * Creates the list of modules to check for get course updates.
     *
     * @param {any[]} modules List of modules.
     * @param {number} courseId Course ID the modules belong to.
     * @return {Promise<{toCheck: any[], cannotUse: any[]}>} Promise resolved with the lists.
     */
    protected createToCheckList(modules: any[], courseId: number) : Promise<{toCheck: any[], cannotUse: any[]}> {
        let result = {
                toCheck: [],
                cannotUse: []
            },
            promises = [];

        modules.forEach((module) => {
            promises.push(this.getModuleStatusAndDownloadTime(module, courseId).then((data) => {
                if (data.status == CoreConstants.DOWNLOADED) {
                    // Module is downloaded and not outdated. Check if it can check updates.
                    return this.canModuleUseCheckUpdates(module, courseId).then((canUse) => {
                        if (canUse) {
                            // Can use check updates, add it to the tocheck list.
                            result.toCheck.push({
                                contextlevel: 'module',
                                id: module.id,
                                since: data.downloadTime || 0
                            });
                        } else {
                            // Cannot use check updates, add it to the cannotUse array.
                            result.cannotUse.push(module);
                        }
                    });
                }
            }).catch(() => {
                // Ignore errors.
            }));
        });

        return Promise.all(promises).then(() => {
            // Sort toCheck list.
            result.toCheck.sort((a, b) => {
                return a.id >= b.id ? 1 : -1;
            });

            return result;
        });
    }

    /**
     * Determines a module status based on current status, restoring downloads if needed.
     *
     * @param {any} module Module.
     * @param {string} status Current status.
     * @param {boolean} [canCheck] True if updates can be checked using core_course_check_updates.
     * @return {string} Module status.
     */
    determineModuleStatus(module: any, status: string, canCheck?: boolean) : string {
        const handler = this.getPrefetchHandlerFor(module),
            siteId = this.sitesProvider.getCurrentSiteId();

        if (handler) {
            if (status == CoreConstants.DOWNLOADING) {
                // Check if the download is being handled.
                if (!this.filepoolProvider.getPackageDownloadPromise(siteId, handler.component, module.id)) {
                    // Not handled, the app was probably restarted or something weird happened.
                    // Re-start download (files already on queue or already downloaded will be skipped).
                    handler.prefetch(module);
                }
            } else if (handler.determineStatus) {
                // The handler implements a determineStatus function. Apply it.
                return handler.determineStatus(module, status, canCheck);
            }
        }
        return status;
    }

    /**
     * Check for updates in a course.
     *
     * @param {any[]} modules List of modules.
     * @param {number} courseId  Course ID the modules belong to.
     * @return {Promise<any>} Promise resolved with the updates. If a module is set to false, it means updates cannot be
     *                        checked for that module in the current site.
     */
    getCourseUpdates(modules: any[], courseId: number) : Promise<any> {
        if (!this.canCheckUpdates()) {
            return Promise.reject(null);
        }

        // Check if there's already a getCourseUpdates in progress.
        let id = <string>Md5.hashAsciiStr(courseId + '#' + JSON.stringify(modules)),
            siteId = this.sitesProvider.getCurrentSiteId();

        if (this.courseUpdatesPromises[siteId] && this.courseUpdatesPromises[siteId][id]) {
            // There's already a get updates ongoing, return the promise.
            return this.courseUpdatesPromises[siteId][id];
        } else if (!this.courseUpdatesPromises[siteId]) {
            this.courseUpdatesPromises[siteId] = {};
        }

        this.courseUpdatesPromises[siteId][id] = this.createToCheckList(modules, courseId).then((data) => {
            let result = {};

            // Mark as false the modules that cannot use check updates WS.
            data.cannotUse.forEach((module) => {
                result[module.id] = false;
            });

            if (!data.toCheck.length) {
                // Nothing to check, no need to call the WS.
                return result;
            }

            // Get the site, maybe the user changed site.
            return this.sitesProvider.getSite(siteId).then((site) => {
                let params = {
                        courseid: courseId,
                        tocheck: data.toCheck
                    },
                    preSets: CoreSiteWSPreSets = {
                        cacheKey: this.getCourseUpdatesCacheKey(courseId),
                        emergencyCache: false, // If downloaded data has changed and offline, just fail. See MOBILE-2085.
                        uniqueCacheKey: true
                    };

                return site.read('core_course_check_updates', params, preSets).then((response) => {
                    if (!response || typeof response.instances == 'undefined') {
                        return Promise.reject(null);
                    }

                    // Store the last execution of the check updates call.
                    let entry = {
                        courseId: courseId,
                        time: this.timeUtils.timestamp()
                    };
                    site.getDb().insertOrUpdateRecord(this.CHECK_UPDATES_TIMES_TABLE, entry, {courseId: courseId});

                    return this.treatCheckUpdatesResult(data.toCheck, response, result);
                }).catch((error) => {
                    // Cannot get updates. Get the cached entries but discard the modules with a download time higher
                    // than the last execution of check updates.
                    return site.getDb().getRecord(this.CHECK_UPDATES_TIMES_TABLE, {courseId: courseId}).then((entry) => {
                        preSets.getCacheUsingCacheKey = true;
                        preSets.omitExpires = true;

                        return site.read('core_course_check_updates', params, preSets).then((response) => {
                            if (!response || typeof response.instances == 'undefined') {
                                return Promise.reject(error);
                            }

                            return this.treatCheckUpdatesResult(data.toCheck, response, result, entry.time);
                        });
                    }, () => {
                        // No previous executions, return result as it is.
                        return result;
                    });
                });
            });
        }).finally(() => {
            // Get updates finished, delete the promise.
            delete this.courseUpdatesPromises[siteId][id];
        });

        return this.courseUpdatesPromises[siteId][id];
    }


    /**
     * Check for updates in a course.
     *
     * @param {number} courseId Course ID the modules belong to.
     * @return {Promise<any>} Promise resolved with the updates.
     */
    getCourseUpdatesByCourseId(courseId: number) : Promise<any> {
        if (!this.canCheckUpdates()) {
            return Promise.reject(null);
        }

        // Get course sections and all their modules.
        return this.courseProvider.getSections(courseId, false, true, {omitExpires: true}).then((sections) => {
            return this.getCourseUpdates(this.courseProvider.getSectionsModules(sections), courseId);
        });
    }

    /**
     * Get cache key for course updates WS calls.
     *
     * @param {number} courseId Course ID.
     * @return {string} Cache key.
     */
    protected getCourseUpdatesCacheKey(courseId: number) : string {
        return this.ROOT_CACHE_KEY + 'courseUpdates:' + courseId;
    }

    /**
     * Get modules download size. Only treat the modules with status not downloaded or outdated.
     *
     * @param {any[]} modules List of modules.
     * @param {number} courseId Course ID the modules belong to.
     * @return {Promise<{size: number, total: boolean}>} Promise resolved with the size and a boolean indicating if it was able
     *                                                   to calculate the total size.
     */
    getDownloadSize(modules: any[], courseId: number) : Promise<{size: number, total: boolean}> {
        // Get the status of each module.
        return this.getModulesStatus(modules, courseId).then((data) => {
            const downloadableModules = data[CoreConstants.NOT_DOWNLOADED].concat(data[CoreConstants.OUTDATED]),
                promises = [],
                result = {
                    size: 0,
                    total: true
                };

            downloadableModules.forEach((module) => {
                promises.push(this.getModuleDownloadSize(module, courseId).then((size) => {
                    result.total = result.total && size.total;
                    result.size += size.size;
                }));
            });

            return Promise.all(promises).then(() => {
                return result;
            });
        });
    }

    /**
     * Get the download size of a module.
     *
     * @param {any} module Module to get size.
     * @param {Number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @return {Promise<{size: number, total: boolean}>} Promise resolved with the size and a boolean indicating if it was able
     *                                                   to calculate the total size.
     */
    getModuleDownloadSize(module: any, courseId: number, single?: boolean) : Promise<{size: number, total: boolean}> {
        let downloadSize,
            packageId,
            handler = this.getPrefetchHandlerFor(module);

        // Check if the module has a prefetch handler.
        if (handler) {
            return this.isModuleDownloadable(module, courseId).then((downloadable) => {
                if (!downloadable) {
                    return {size: 0, total: true};
                }

                packageId = this.filepoolProvider.getPackageId(handler.component, module.id);
                downloadSize = this.statusCache.getValue(packageId, 'downloadSize');
                if (typeof downloadSize != 'undefined') {
                    return downloadSize;
                }

                return Promise.resolve(handler.getDownloadSize(module, courseId, single)).then((size) => {
                    return this.statusCache.setValue(packageId, 'downloadSize', size);
                }).catch((error) => {
                    const cachedSize = this.statusCache.getValue(packageId, 'downloadSize', true);
                    if (cachedSize) {
                        return cachedSize;
                    }
                    return Promise.reject(error);
                });
            });
        }

        return Promise.resolve({size: 0, total: false});
    }

    /**
     * Get the download size of a module.
     *
     * @param {any} module Module to get size.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<number>} Promise resolved with the size.
     */
    getModuleDownloadedSize(module: any, courseId: number) : Promise<number> {
        let downloadedSize,
            packageId,
            promise,
            handler = this.getPrefetchHandlerFor(module);

        // Check if the module has a prefetch handler.
        if (handler) {
            return this.isModuleDownloadable(module, courseId).then((downloadable) => {
                if (!downloadable) {
                    return 0;
                }

                packageId = this.filepoolProvider.getPackageId(handler.component, module.id);
                downloadedSize = this.statusCache.getValue(packageId, 'downloadedSize');
                if (typeof downloadedSize != 'undefined') {
                    return downloadedSize;
                }

                if (handler.getDownloadedSize) {
                    // Handler implements a method to calculate the downloaded size, use it.
                    promise = Promise.resolve(handler.getDownloadedSize(module, courseId));
                } else {
                    // Handler doesn't implement it, get the module files and check if they're downloaded.
                    promise = this.getModuleFiles(module, courseId).then((files) => {
                        let siteId = this.sitesProvider.getCurrentSiteId(),
                            promises = [],
                            size = 0;

                        // Retrieve file size if it's downloaded.
                        files.forEach((file) => {
                            const fileUrl = file.url || file.fileurl;
                            promises.push(this.filepoolProvider.getFilePathByUrl(siteId, fileUrl).then((path) => {
                                return this.fileProvider.getFileSize(path).catch(() => {
                                    // Error getting size. Check if the file is being downloaded.
                                    return this.filepoolProvider.isFileDownloadingByUrl(siteId, fileUrl).then(() => {
                                        // If downloading, count as downloaded.
                                        return file.filesize;
                                    }).catch(() => {
                                        // Not downloading and not found in disk.
                                        return 0;
                                    });
                                }).then((fs) => {
                                    size += fs;
                                });
                            }));
                        });

                        return Promise.all(promises).then(() => {
                            return size;
                        });
                    });
                }

                return promise.then((size) => {
                    return this.statusCache.setValue(packageId, 'downloadedSize', size);
                }).catch(() => {
                    return this.statusCache.getValue(packageId, 'downloadedSize', true);
                });
            });
        }

        return Promise.resolve(0);
    }

    /**
     * Get module files.
     *
     * @param {any} module Module to get the files.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<any[]>} Promise resolved with the list of files.
     */
    getModuleFiles(module: any, courseId: number) : Promise<any[]> {
        const handler = this.getPrefetchHandlerFor(module);

        if (handler.getFiles) {
            // The handler defines a function to get files, use it.
            return Promise.resolve(handler.getFiles(module, courseId));
        } else if (handler.loadContents) {
            // The handler defines a function to load contents, use it before returning module contents.
            return handler.loadContents(module, courseId).then(() => {
                return module.contents;
            });
        } else {
            return Promise.resolve(module.contents || []);
        }
    }

    /**
     * Get the module status.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @param {any} [updates] Result of getCourseUpdates for all modules in the course. If not provided, it will be
     *                        calculated (slower). If it's false it means the site doesn't support check updates.
     * @param {boolean} [refresh] True if it should ignore the cache.
     * @param {number} [sectionId] ID of the section the module belongs to.
     * @return {Promise<string>} Promise resolved with the status.
     */
    getModuleStatus(module: any, courseId: number, updates?: any, refresh?: boolean, sectionId?: number) : Promise<string> {
        let handler = this.getPrefetchHandlerFor(module),
            siteId = this.sitesProvider.getCurrentSiteId(),
            canCheck = this.canCheckUpdates();

        if (handler) {
            // Check if the status is cached.
            let component = handler.component,
                packageId = this.filepoolProvider.getPackageId(component, module.id),
                status = this.statusCache.getValue(packageId, 'status'),
                updateStatus = true,
                promise;

            if (!refresh && typeof status != 'undefined') {
                return Promise.resolve(this.determineModuleStatus(module, status, canCheck));
            }

            // Check if the module is downloadable.
            return this.isModuleDownloadable(module, courseId).then((downloadable) => {
                if (!downloadable) {
                    return CoreConstants.NOT_DOWNLOADABLE;
                }

                // Get the saved package status.
                return this.filepoolProvider.getPackageStatus(siteId, component, module.id).then((currentStatus) => {
                    status = handler.determineStatus ? handler.determineStatus(module, status, canCheck) : status;
                    if (status != CoreConstants.DOWNLOADED) {
                        return status;
                    }

                    // Module is downloaded. Determine if there are updated in the module to show them outdated.
                    if (typeof updates == 'undefined') {
                        // We don't have course updates, calculate them.
                        promise = this.getCourseUpdatesByCourseId(courseId);
                    } else if (updates === false) {
                        // Cannot check updates.
                        return Promise.resolve();
                    } else {
                        promise = Promise.resolve(updates);
                    }

                    return promise.then((updates) => {
                        if (!updates || updates[module.id] === false) {
                            // Cannot check updates, always show outdated.
                            return CoreConstants.OUTDATED;
                        }

                        // Check if the module has any update.
                        return this.moduleHasUpdates(module, courseId, updates).then((hasUpdates) => {
                            if (!hasUpdates) {
                                // No updates, keep current status.
                                return status;
                            }

                            // Has updates, mark the module as outdated.
                            status = CoreConstants.OUTDATED;
                            return this.filepoolProvider.storePackageStatus(siteId, component, module.id, status).catch(() => {
                                // Ignore errors.
                            }).then(() => {
                                return status;
                            });
                        }).catch(() => {
                            // Error checking if module has updates.
                            const status = this.statusCache.getValue(packageId, 'status', true);
                            return this.determineModuleStatus(module, status, canCheck);
                        });
                    }, () => {
                        // Error getting updates, show the stored status.
                        updateStatus = false;
                        return currentStatus;
                    });
                });
            }).then((status) => {
                if (updateStatus) {
                    this.updateStatusCache(status, courseId, component, module.id, sectionId);
                }
                return this.determineModuleStatus(module, status, canCheck);
            });
        }

        // No handler found, module not downloadable.
        return Promise.resolve(CoreConstants.NOT_DOWNLOADABLE);
    }

    /**
     * Get the status of a list of modules, along with the lists of modules for each status.
     * @see {@link CoreFilepoolProvider.determinePackagesStatus}
     *
     * @param {any[]} modules List of modules to prefetch.
     * @param {number} courseId Course ID the modules belong to.
     * @param {number} [sectionId] ID of the section the modules belong to.
     * @param {boolean} [refresh] True if it should always check the DB (slower).
     * @return {Promise<any>} Promise resolved with an object with the following properties:
     *                                - status (string) Status of the module.
     *                                - total (number) Number of modules.
     *                                - CoreConstants.NOT_DOWNLOADED (any[]) Modules with state NOT_DOWNLOADED.
     *                                - CoreConstants.DOWNLOADED (any[]) Modules with state DOWNLOADED.
     *                                - CoreConstants.DOWNLOADING (any[]) Modules with state DOWNLOADING.
     *                                - CoreConstants.OUTDATED (any[]) Modules with state OUTDATED.
     */
    getModulesStatus(modules: any[], courseId: number, sectionId?: number, refresh?: boolean) : any {
        let promises = [],
            status = CoreConstants.NOT_DOWNLOADABLE,
            result: any = {
                total: 0
            };

        // Init result.
        result[CoreConstants.NOT_DOWNLOADED] = [];
        result[CoreConstants.DOWNLOADED] = [];
        result[CoreConstants.DOWNLOADING] = [];
        result[CoreConstants.OUTDATED] = [];

        // Check updates in course. Don't use getCourseUpdates because the list of modules might not be the whole course list.
        return this.getCourseUpdatesByCourseId(courseId).catch(() => {
            // Cannot get updates.
            return false;
        }).then((updates) => {

            modules.forEach((module) => {
                // Check if the module has a prefetch handler.
                let handler = this.getPrefetchHandlerFor(module);
                if (handler) {
                    let packageId = this.filepoolProvider.getPackageId(handler.component, module.id);

                    promises.push(this.getModuleStatus(module, courseId, updates, refresh).then((modStatus) => {
                        if (modStatus != CoreConstants.NOT_DOWNLOADABLE) {
                            if (sectionId && sectionId > 0) {
                                // Store the section ID.
                                this.statusCache.setValue(packageId, 'sectionId', sectionId);
                            }

                            status = this.filepoolProvider.determinePackagesStatus(status, modStatus);
                            result[modStatus].push(module);
                            result.total++;
                        }
                    }).catch((error) => {
                        let cacheStatus = this.statusCache.getValue(packageId, 'status', true);
                        if (typeof cacheStatus == 'undefined') {
                            return Promise.reject(error);
                        }

                        if (cacheStatus != CoreConstants.NOT_DOWNLOADABLE) {
                            cacheStatus = this.filepoolProvider.determinePackagesStatus(status, cacheStatus);
                            result[cacheStatus].push(module);
                            result.total++;
                        }
                    }));
                }
            });

            return Promise.all(promises).then(() => {
                result.status = status;
                return result;
            });
        });
    }

    /**
     * Get a module status and download time. It will only return the download time if the module is downloaded and not outdated.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<{status: string, downloadTime?: number}>} Promise resolved with the data.
     */
    protected getModuleStatusAndDownloadTime(module: any, courseId: number) : Promise<{status: string, downloadTime?: number}> {
        let handler = this.getPrefetchHandlerFor(module),
            siteId = this.sitesProvider.getCurrentSiteId();

        if (handler) {
            // Get the status from the cache.
            let packageId = this.filepoolProvider.getPackageId(handler.component, module.id),
                status = this.statusCache.getValue(packageId, 'status');

            if (typeof status != 'undefined' && status != CoreConstants.DOWNLOADED) {
                // Status is different than downloaded, just return the status.
                return Promise.resolve({
                    status: status
                });
            }

            // Check if the module is downloadable.
            return this.isModuleDownloadable(module, courseId).then((downloadable: boolean) : any => {
                if (!downloadable) {
                    return {
                        status: CoreConstants.NOT_DOWNLOADABLE
                    };
                }

                // Get the stored data to get the status and downloadTime.
                return this.filepoolProvider.getPackageData(siteId, handler.component, module.id).then((data) => {
                    return {
                        status: data.status,
                        downloadTime: data.downloadTime || 0
                    };
                });
            });
        }

        // No handler found, module not downloadable.
        return Promise.resolve({
            status: CoreConstants.NOT_DOWNLOADABLE
        });
    }

    /**
     * Get a prefetch handler.
     *
     * @param {any} module The module to work on.
     * @return {CoreCourseModulePrefetchHandler} Prefetch handler.
     */
    getPrefetchHandlerFor(module: any) : CoreCourseModulePrefetchHandler {
        return this.enabledHandlers[module.modname];
    }

    /**
     * Invalidate check updates WS call.
     *
     * @param {number} courseId Course ID.
     * @return {Promise<any>} Promise resolved when data is invalidated.
     */
    invalidateCourseUpdates(courseId: number) : Promise<any> {
        return this.sitesProvider.getCurrentSite().invalidateWsCacheForKey(this.getCourseUpdatesCacheKey(courseId));
    }

    /**
     * Invalidate a list of modules in a course. This should only invalidate WS calls, not downloaded files.
     *
     * @param {any[]} modules List of modules.
     * @param {number} courseId Course ID.
     * @return {Promise<any>} Promise resolved when modules are invalidated.
     */
    invalidateModules(modules: any[], courseId: number) : Promise<any> {
        let promises = [];

        modules.forEach((module) => {
            const handler = this.getPrefetchHandlerFor(module);
            if (handler) {
                if (handler.invalidateModule) {
                    promises.push(handler.invalidateModule(module, courseId).catch(() => {
                        // Ignore errors.
                    }));
                }

                // Invalidate cache.
                this.invalidateModuleStatusCache(module);
            }
        });

        promises.push(this.invalidateCourseUpdates(courseId));

        return Promise.all(promises);
    }

    /**
     * Invalidates the cache for a given module.
     *
     * @param {any} module Module to be invalidated.
     */
    invalidateModuleStatusCache(module: any) : void {
        const handler = this.getPrefetchHandlerFor(module);
        if (handler) {
            this.statusCache.invalidate(this.filepoolProvider.getPackageId(handler.component, module.id));
        }
    }

    /**
     * Check if a list of modules is being downloaded.
     *
     * @param {string} id An ID to identify the download.
     * @return {boolean} True if it's being downloaded, false otherwise.
     */
    isBeingDownloaded(id: string) : boolean {
        const siteId = this.sitesProvider.getCurrentSiteId();
        return !!(this.prefetchData[siteId] && this.prefetchData[siteId][id]);
    }

    /**
     * Check if a time belongs to the last update handlers call.
     * This is to handle the cases where updateHandlers don't finish in the same order as they're called.
     *
     * @param {number} time Time to check.
     * @return {boolean} Whether it's the last call.
     */
    isLastUpdateCall(time: number) : boolean {
        if (!this.lastUpdateHandlersStart) {
            return true;
        }
        return time == this.lastUpdateHandlersStart;
    }

    /**
     * Check if a module is downloadable.
     *
     * @param {any} module Module.
     * @param {Number} courseId Course ID the module belongs to.
     * @return {Promise<boolean>} Promise resolved with true if downloadable, false otherwise.
     */
    isModuleDownloadable(module: any, courseId: number) : Promise<boolean> {
        let handler = this.getPrefetchHandlerFor(module);

        if (handler) {
            if (typeof handler.isDownloadable == 'function') {
                let packageId = this.filepoolProvider.getPackageId(handler.component, module.id),
                    downloadable = this.statusCache.getValue(packageId, 'downloadable');

                if (typeof downloadable != 'undefined') {
                    return Promise.resolve(downloadable);
                } else {
                    return Promise.resolve(handler.isDownloadable(module, courseId)).then((downloadable) => {
                        return this.statusCache.setValue(packageId, 'downloadable', downloadable);
                    }).catch(() => {
                        // Something went wrong, assume it's not downloadable.
                        return false;
                    });
                }
            } else {
                // Function not defined, assume it's not downloadable.
                return Promise.resolve(true);
            }
        } else {
            // No handler for module, so it's not downloadable.
            return Promise.resolve(false);
        }
    }

    /**
     * Check if a module has updates based on the result of getCourseUpdates.
     *
     * @param {any} module Module.
     * @param {number} courseId Course ID the module belongs to.
     * @param {any} updates Result of getCourseUpdates.
     * @return {Promise<boolean>} Promise resolved with boolean: whether the module has updates.
     */
    moduleHasUpdates(module: any, courseId: number, updates: any) : Promise<boolean> {
        let handler = this.getPrefetchHandlerFor(module),
            moduleUpdates = updates[module.id];

        if (handler && handler.hasUpdates) {
            // Handler implements its own function to check the updates, use it.
            return Promise.resolve(handler.hasUpdates(module, courseId, moduleUpdates));
        } else if (!moduleUpdates || !moduleUpdates.updates || !moduleUpdates.updates.length) {
            // Module doesn't have any update.
            return Promise.resolve(false);
        } else if (handler && handler.updatesNames && handler.updatesNames.test) {
            // Check the update names defined by the handler.
            for (let i = 0, len = moduleUpdates.updates.length; i < len; i++) {
                if (handler.updatesNames.test(moduleUpdates.updates[i].name)) {
                    return Promise.resolve(true);
                }
            }

            return Promise.resolve(false);
        }

        // Handler doesn't define hasUpdates or updatesNames and there is at least 1 update. Assume it has updates.
        return Promise.resolve(true);
    }

    /**
     * Prefetch a module.
     *
     * @param {any} module Module to prefetch.
     * @param {number} courseId Course ID the module belongs to.
     * @param {boolean} [single] True if we're downloading a single module, false if we're downloading a whole section.
     * @return {Promise<any>} Promise resolved when finished.
     */
    prefetchModule(module: any, courseId: number, single?: boolean) : Promise<any> {
        const handler = this.getPrefetchHandlerFor(module);

        // Check if the module has a prefetch handler.
        if (handler) {
            return handler.prefetch(module, courseId, single);
        }
        return Promise.resolve();
    }

    /**
     * Prefetches a list of modules using their prefetch handlers.
     * If a prefetch already exists for this site and id, returns the current promise.
     *
     * @param {string} id An ID to identify the download. It can be used to retrieve the download promise.
     * @param {any[]} modules List of modules to prefetch.
     * @param {number} courseId Course ID the modules belong to.
     * @param {CoreCourseModulesProgressFunction} [onProgress] Function to call everytime a module is downloaded.
     * @return {Promise<any>} Promise resolved when all modules have been prefetched.
     */
    prefetchModules(id: string, modules: any[], courseId: number, onProgress?: CoreCourseModulesProgressFunction) : Promise<any> {

        const siteId = this.sitesProvider.getCurrentSiteId(),
            currentData = this.prefetchData[siteId] && this.prefetchData[siteId][id];

        if (currentData) {
            // There's a prefetch ongoing, return the current promise.
            if (onProgress) {
                currentData.subscriptions.push(currentData.observable.subscribe(onProgress));
            }
            return currentData.promise;
        }

        let promises = [],
            count = 0,
            total = modules.length,
            moduleIds = modules.map((module) => {
                return module.id;
            });

        // Initialize the prefetch data.
        const prefetchData = {
            observable: new BehaviorSubject<CoreCourseModulesProgress>({count: count, total: total}),
            promise: undefined,
            subscriptions: []
        };

        if (onProgress) {
            prefetchData.observable.subscribe(onProgress);
        }

        modules.forEach((module) => {
            // Check if the module has a prefetch handler.
            const handler = this.getPrefetchHandlerFor(module);
            if (handler) {
                promises.push(this.isModuleDownloadable(module, courseId).then((downloadable) => {
                    if (!downloadable) {
                        return;
                    }

                    return handler.prefetch(module, courseId).then(() => {
                        let index = moduleIds.indexOf(id);
                        if (index > -1) {
                            // It's one of the modules we were expecting to download.
                            moduleIds.splice(index, 1);
                            count++;
                            prefetchData.observable.next({count: count, total: total});
                        }
                    });
                }));
            }
        });

        // Set the promise.
        prefetchData.promise = Promise.all(promises).finally(() => {
            // Unsubscribe all observers.
            prefetchData.subscriptions.forEach((subscription: Subscription) => {
                subscription.unsubscribe();
            });
            delete this.prefetchData[siteId][id];
        });

        // Store the prefetch data in the list.
        if (!this.prefetchData[siteId]) {
            this.prefetchData[siteId] = {};
        }
        this.prefetchData[siteId][id] = prefetchData;

        return prefetchData.promise;
    }

    /**
     * Register a handler.
     *
     * @param {CoreCourseModulePrefetchHandler} handler The handler to register.
     * @return {boolean} True if registered successfully, false otherwise.
     */
    registerHandler(handler: CoreCourseModulePrefetchHandler) : boolean {
        if (typeof this.handlers[handler.modname] !== 'undefined') {
            this.logger.log('There is an addon named \'' + this.handlers[handler.modname].name +
                    '\' already registered as a prefetch handler for ' + handler.modname);
            return false;
        }
        this.logger.log(`Registered addon '${handler.name}' as a prefetch handler for '${handler.modname}'`);
        this.handlers[handler.modname] = handler;
        return true;
    }

    /**
     * Remove module Files from handler.
     *
     * @param {any} module Module to remove the files.
     * @param {number} courseId Course ID the module belongs to.
     * @return {Promise<void>} Promise resolved when done.
     */
    removeModuleFiles(module: any, courseId: number) : Promise<void> {
        let handler = this.getPrefetchHandlerFor(module),
            siteId = this.sitesProvider.getCurrentSiteId(),
            promise;

        if (handler && handler.removeFiles) {
            // Handler implements a method to remove the files, use it.
            promise = handler.removeFiles(module, courseId);
        } else {
            // No method to remove files, use get files to try to remove the files.
            promise = this.getModuleFiles(module, courseId).then((files) => {
                let promises = [];
                files.forEach((file) => {
                    promises.push(this.filepoolProvider.removeFileByUrl(siteId, file.url || file.fileurl).catch(() => {
                        // Ignore errors.
                    }));
                });
                return Promise.all(promises);
            });
        }

        return promise.then(() => {
            if (handler) {
                // Update status of the module.
                const packageId = this.filepoolProvider.getPackageId(handler.component, module.id);
                this.statusCache.setValue(packageId, 'downloadedSize', 0);
                this.filepoolProvider.storePackageStatus(siteId, handler.component, module.id, CoreConstants.NOT_DOWNLOADED);
            }
        });
    }

    /**
     * Set an on progress function for the download of a list of modules.
     *
     * @param {string} id An ID to identify the download.
     * @param {CoreCourseModulesProgressFunction} onProgress Function to call everytime a module is downloaded.
     */
    setOnProgress(id: string, onProgress: CoreCourseModulesProgressFunction) : void {
        const siteId = this.sitesProvider.getCurrentSiteId(),
            currentData = this.prefetchData[siteId] && this.prefetchData[siteId][id];

        if (currentData) {
            // There's a prefetch ongoing, return the current promise.
            currentData.subscriptions.push(currentData.observable.subscribe(onProgress));
        }
    }

    /**
     * Treat the result of the check updates WS call.
     *
     * @param {any[]} toCheckList List of modules to check (from createToCheckList).
     * @param {any} response WS call response.
     * @param {any} result Object where to store the result.
     * @param {number} [previousTime] Time of the previous check updates execution. If set, modules downloaded
     *                                after this time will be ignored.
     * @return {any} Result.
     */
    protected treatCheckUpdatesResult(toCheckList: any[], response: any, result: any, previousTime?: number) : any {
        // Format the response to index it by module ID.
        this.utils.arrayToObject(response.instances, 'id', result);

        // Treat warnings, adding the not supported modules.
        response.warnings.forEach((warning) => {
            if (warning.warningcode == 'missingcallback') {
                result[warning.itemid] = false;
            }
        });

        if (previousTime) {
            // Remove from the list the modules downloaded after previousTime.
            toCheckList.forEach((entry) => {
                if (result[entry.id] && entry.since > previousTime) {
                    delete result[entry.id];
                }
            });
        }

        return result;
    }

    /**
     * Update the enabled handlers for the current site.
     *
     * @param {CoreCourseModulePrefetchHandler} handler The handler to treat.
     * @param {number} time Time this update process started.
     * @return {Promise<void>} Resolved when done.
     */
    updateHandler(handler: CoreCourseModulePrefetchHandler, time: number) : Promise<void> {
        let promise,
            siteId = this.sitesProvider.getCurrentSiteId();

        if (!siteId) {
            promise = Promise.reject(null);
        } else {
            promise = Promise.resolve(handler.isEnabled());
        }

        // Checks if the prefetch is enabled.
        return promise.catch(() => {
            return false;
        }).then((enabled: boolean) => {
            // Verify that this call is the last one that was started.
            // Check that site hasn't changed since the check started.
            if (this.isLastUpdateCall(time) && this.sitesProvider.getCurrentSiteId() == siteId) {
                if (enabled) {
                    this.enabledHandlers[handler.modname] = handler;
                } else {
                    delete this.enabledHandlers[handler.modname];
                }
            }
        });
    }

    /**
     * Update the handlers for the current site.
     *
     * @return {Promise<any>} Resolved when done.
     */
    updateHandlers() : Promise<any> {
        const promises = [],
            now = Date.now();

        this.lastUpdateHandlersStart = now;

        // Loop over all the handlers.
        for (let name in this.handlers) {
            promises.push(this.updateHandler(this.handlers[name], now));
        }

        return Promise.all(promises).catch(() => {
            // Never reject.
        });
    }

    /**
     * Update the status of a module in the "cache".
     *
     * @param {string} status New status.
     * @param {number} courseId Course ID of the module.
     * @param {string} component Package's component.
     * @param {string|number} [componentId] An ID to use in conjunction with the component.
     * @param {number} [sectionId] Section ID of the module.
     */
    updateStatusCache(status: string, courseId: number, component: string, componentId?: string|number, sectionId?: number) : void {
        let notify,
            packageId = this.filepoolProvider.getPackageId(component, componentId),
            cachedStatus = this.statusCache.getValue(packageId, 'status', true);

        // If the status has changed, notify that the section has changed.
        notify = typeof cachedStatus != 'undefined' && cachedStatus !== status;

        if (notify) {
            if (!sectionId) {
                sectionId = this.statusCache.getValue(packageId, 'sectionId', true);
            }

            // Invalidate and set again.
            this.statusCache.invalidate(packageId);
            this.statusCache.setValue(packageId, 'status', status);

            if (sectionId) {
                this.statusCache.setValue(packageId, 'sectionId', sectionId);

                this.eventsProvider.trigger(CoreEventsProvider.SECTION_STATUS_CHANGED, {
                    sectionId: sectionId,
                    courseId: courseId
                }, this.sitesProvider.getCurrentSiteId());
            }
        } else {
            this.statusCache.setValue(packageId, 'status', status);
        }
    }
}
